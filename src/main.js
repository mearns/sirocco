const { addArgs } = require("./cli-helper");
const { CallerError, ConfigError } = require("./errors");
const fs = require("fs");
const getDeployerFactory = require("./deployer-factory");
const chalk = require("chalk");
const path = require("path");

async function main() {
    const [, , ...argv] = process.argv;
    const yargs = require("yargs");
    const args = yargs
        .option("config", {
            global: true,
            describe: "The path to the config file to load",
            default: null,
            type: "string",
            coerce: loadConfigFile
        })
        .option("options", {
            global: true,
            config: true,
            describe:
                "Path to a JSON file that specifies additional options for the command"
        })
        .option("env-name-env-var", {
            global: true,
            default: "CI_ENVIRONMENT_NAME",
            type: "string",
            describe:
                "The name of an environment variable that the environment name can be read from if not specified",
            hidden: true
        })
        .option("env-name-separator", {
            global: true,
            default: "-",
            type: "string",
            describe:
                "The character that delimits various levels of the environment name when loaded from an env var",
            hidden: true
        })
        .option("branch-deploy-type", {
            global: true,
            array: true,
            type: "string",
            default: ["dev"],
            describe:
                "Specify the given deploy type as one that is deployed from a branch"
        })
        .command(
            "deploy [DEPLOY_TYPE] [STACKS...]",
            "Deploy the specified stacks",
            _yargs => {
                addArgs(_yargs, { prepare: true, deploy: true });
            }
        )
        .strict()
        .fail(function(msg, err, yargs) {
            if (err && !(err instanceof CallerError)) {
                throw err;
            }
            console.error(msg);
            process.exit(1);
        })
        .demandCommand(1, 1)
        .parse(argv);
    const [command] = args._;
    try {
        switch (command) {
            case "deploy":
                await runDeploy(args);
                break;
            default:
                throw new Error(`Unhandled command: ${command}`);
        }
    } catch (error) {
        if (error instanceof String) {
            console.error(error.message);
            process.exitCode = 1;
        } else {
            console.error(error.stack);
            process.exitCode = -2;
        }
    }
}

function loadConfigFile(configPath) {
    if (configPath) {
        return loadFileForConfig(configPath);
    }
    const tryPaths = [".sirocco.js", ".sirocco.json"];
    const existingPaths = tryPaths.filter(p => {
        try {
            fs.accessSync(p, fs.constants.F_OK);
        } catch (error) {
            if (error.syscall === "access" && error.code === "ENOENT") {
                return false;
            }
            throw error;
        }
        return true;
    });
    if (existingPaths.length > 0) {
        if (existingPaths.length > 1) {
            throw new ConfigError(
                `Multiple sirocco configurations found: ${existingPaths.join(
                    ", "
                )}`
            );
        }
        const [foundPath] = existingPaths;
        return loadFileForConfig(foundPath);
    }
    return {};
}

function loadFileForConfig(configPath) {
    try {
        return require(path.resolve(configPath));
    } catch (error) {
        const ce = new ConfigError(
            `An error occurred attempting to load the config file: ${error.message}`
        );
        ce.stack = error.stack;
        throw ce;
    }
}

function runStepsForDeployers(deployers, ...steps) {
    const outputsByDeployer = new Array(deployers.length).fill(null).map(() => {
        return [];
    });
    return steps.reduce((p1, step, stepIdx) => {
        const [description, stepSpecifier] = Array.isArray(step)
            ? step
            : typeof step === "function"
            ? [step.name || `#${stepIdx}`, step]
            : [step, step];
        const stepFunction =
            typeof stepSpecifier === "function"
                ? stepSpecifier
                : (deployer, ...args) => deployer[step](...args);
        return deployers.reduce((p2, deployer, deployerIdx) => {
            return p2
                .then(() => {
                    if (description) {
                        console.log(
                            chalk.blue(
                                `Running step "${description}" (${stepIdx +
                                    1} of ${steps.length}) on stack: ${
                                    deployer.targetStack
                                } (${deployerIdx + 1} / ${deployers.length})`
                            )
                        );
                    }
                    return stepFunction(
                        deployer,
                        ...outputsByDeployer[deployerIdx]
                    );
                })
                .then(result => {
                    outputsByDeployer[deployerIdx].push(result);
                    return result;
                });
        }, p1);
    }, Promise.resolve());
}

function getStacksToRunFromConfig(config) {
    const stacks = config.defaultStacks || [];
    if (Array.isArray(stacks)) {
        return stacks;
    } else if (typeof stacks === "string") {
        return [stacks];
    }
    throw new ConfigError('Invalid value for "stacks" config property.');
}

async function runDeploy(args) {
    const { config } = args;
    const createDeployer = await getDeployerFactory(args);
    const stacks =
        args.stacks.length === 0
            ? getStacksToRunFromConfig(config)
            : args.stacks;
    if (stacks.length === 0) {
        throw new CallerError(
            "No stacks specified, and non inferred from config"
        );
    }
    const deployers = stacks.map(createDeployer);
    await runStepsForDeployers(
        deployers,
        [
            "prepare",
            async deployer => {
                await deployer.authenticate();
                await deployer.prepare();
            }
        ],
        [
            "deploy",
            async deployer => {
                await deployer.authenticate();
                await deployer.deploy();
            }
        ]
    );
}

main();
