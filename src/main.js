#!/usr/bin/env node

const { addArgs } = require("./cli-helper");
const { CallerError, ConfigError } = require("./errors");
const fs = require("fs");
const getDeployerFactory = require("./deployer-factory");
const chalk = require("chalk");
const path = require("path");
const { validateConfig } = require("./config-schema");
const yaml = require("js-yaml");
const yargs = require("yargs");
const { logNamedValue } = require("./logger");
const buildObject = require("build-object-better");

const promisify = fn => (...args) =>
    new Promise((resolve, reject) => {
        fn(...args, (error, result) => {
            if (error) {
                reject(error);
            } else {
                resolve(result);
            }
        });
    });

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);
const access = promisify(fs.access);

async function main() {
    const arg0 = path.basename(process.argv[1]);
    const configFromFile = await loadConfigFile();
    const hasConfig = configFromFile !== null;
    const config = configFromFile || {};
    const options = config.options || {};
    delete config.options;
    const [, , ...argv] = process.argv;
    const args = yargs
        .config(options)
        .option("validate", {
            global: true,
            type: "boolean",
            default: true,
            describe: "Whether or not to validate the config file"
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
            default: "/",
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
        .option("dump", {
            global: true,
            type: "boolean",
            default: false,
            describe:
                'Dump JSON description of the resolved deployments to "sirocco.dump.json"'
        })
        .option("debug", {
            hidden: true,
            type: "boolean"
        })
        .command(
            "deploy [DEPLOY-TYPE]",
            "Deploy the specified stacks",
            addArgsForDeployLikeCommand
        )
        .command(
            "teardown [DEPLOY-TYPE]",
            "Teardown the specified stacks",
            addArgsForDeployLikeCommand
        )
        .command(
            "preview [DEPLOY-TYPE]",
            "Show the parameters values that would be used for the deploy",
            addArgsForDeployLikeCommand
        )
        .command(
            "describe [DEPLOY-TYPE]",
            "Get some information about the specified cloudformation stacks",
            addArgsForDeployLikeCommand
        )
        .command(
            "get-events [DEPLOY-TYPE]",
            "Get a log of cloudwatch events for the specified cloudformation stacks",
            addArgsForDeployLikeCommand
        )
        .command(
            "find-physical-id [DEPLOY-TYPE]",
            "Get the physical ID of one or more resource from the specified stack",
            addArgsForFindPhysicalId
        )
        .command("validate", "Validate the chosen config file", _yargs =>
            _yargs.strict(false)
        )
        .strict()
        .fail(function(msg, err, yargs) {
            if (err && !(err instanceof CallerError)) {
                throw err;
            }
            console.error(`[${arg0}] ERROR: ${(err && err.message) || msg}`);
            process.exit(1);
        })
        .demandCommand(1, 1, "Must specify a command")
        .check(args => {
            if (args._.length > 1) {
                throw new CallerError(
                    `Unknown positional argument(s): ${args._.slice(1).join(
                        ", "
                    )}`
                );
            }
            return true;
        })
        .parse(argv);
    // Avoid ambiguous ways to access the same option.
    Object.keys(args)
        .filter(propName => /-/.test(propName))
        .forEach(propName => {
            delete args[propName];
        });
    args.config = config;
    args.hasConfig = hasConfig;
    const [command] = args._;
    try {
        switch (command) {
            case "deploy":
                await runDeploy(args);
                break;
            case "teardown":
                await runTeardown(args);
                break;
            case "preview":
                await runPreview(args);
                break;
            case "find-physical-id":
                await runFindPhysicalId(args);
                break;
            case "describe":
                await runDescribe(args);
                break;
            case "validate":
                await runValidate(args);
                break;
            case "get-events":
                await runGetEvents(args);
                break;
            default:
                throw new Error(`Unhandled command: ${command}`);
        }
    } catch (error) {
        if (args.debug) {
            console.error(error);
            process.exitCode = -3;
        } else {
            if (error instanceof CallerError) {
                console.error(error.message);
                process.exitCode = 1;
            } else {
                console.error(error.stack);
                process.exitCode = -2;
            }
        }
    }
}

function addArgsForDeployLikeCommand(_yargs) {
    addArgs(_yargs, { prepare: true, deploy: true });
    _yargs
        .option("stack", {
            alias: "stacks",
            array: true,
            type: "string",
            nargs: 1
        })
        .positional("DEPLOY-TYPE", {
            describe: "The deployment type.",
            type: "string",
            nargs: 1
        })
        .strict();
}

function addArgsForFindPhysicalId(_yargs) {
    addArgs(_yargs, { prepare: true, deploy: true });
    _yargs
        .option("resource", {
            alias: "resources",
            describe:
                'Which resource do you want to look up. Specify like "<STACK-NAME>.<LOGICAL-ID>[.<LOGICAL-ID>[...]]"',
            array: true,
            type: "string",
            default: [],
            nargs: 1
        })
        .positional("DEPLOY-TYPE", {
            describe: "The deployment type.",
            type: "string",
            nargs: 1
        })
        .strict();
}

async function loadConfigFile() {
    const configPath = await chooseConfigFilePath();
    if (configPath) {
        return readConfigFromFile(configPath);
    }
    return null;
}

async function chooseConfigFilePath() {
    const tryPaths = [
        ".sirocco.js",
        ".sirocco.json",
        ".sirocco.yml",
        ".sirocco.yaml"
    ];
    const existingPaths = (await Promise.all(
        tryPaths.map(async potentialPath => {
            try {
                await access(potentialPath, fs.constants.F_OK);
            } catch (error) {
                if (error.syscall === "access" && error.code === "ENOENT") {
                    return false;
                }
                throw error;
            }
            return potentialPath;
        })
    )).filter(potentialPath => potentialPath !== false);
    if (existingPaths.length > 0) {
        if (existingPaths.length > 1) {
            throw new ConfigError(
                `Multiple sirocco configurations found: ${existingPaths.join(
                    ", "
                )}`
            );
        }
        const [foundPath] = existingPaths;
        return foundPath;
    }
    return null;
}

async function readConfigFromFile(configPath) {
    try {
        if (configPath.endsWith(".yml") || configPath.endsWith("yaml")) {
            return yaml.safeLoad(await readFile(configPath, "utf8"));
        } else if (configPath.endsWith(".json")) {
            return JSON.parse(await readFile(configPath, "utf8"));
        }
        const mod = require(path.resolve(configPath));
        if (typeof mod === "function") {
            return await mod();
        }
        return mod;
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
                                `Running step ${chalk.cyanBright(
                                    description
                                )} (${stepIdx + 1} of ${
                                    steps.length
                                }) on stack: ${chalk.cyanBright(
                                    deployer.targetStack
                                )} (${deployerIdx + 1} / ${deployers.length})`
                            )
                        );
                    }
                    return stepFunction(
                        deployer,
                        ...outputsByDeployer[deployerIdx]
                    );
                })
                .then(result => {
                    console.log();
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

async function runValidate(args) {
    const { config } = args;
    validateConfig(config);
    console.log("Config file validated successfully");
}

async function getDeployers(args) {
    const { config } = args;
    if (args.validate) {
        validateConfig(config);
    }
    const createDeployer = await getDeployerFactory(args);
    const [stacks, stacksFrom] =
        args.stacks && args.stacks.length > 0
            ? [args.stacks, "from --stack option"]
            : [
                  getStacksToRunFromConfig(config),
                  "from config.defaultStacks file"
              ];
    if (stacks.length === 0) {
        throw new CallerError(
            "No stacks specified, and non inferred from config"
        );
    }
    logNamedValue("Targeted stacks", stacks.join(", "), stacksFrom);
    if (args.dryRun) {
        console.log(
            chalk.red(
                "This is a dry run, no commands will actually be executed"
            )
        );
    }
    const deployments = buildObject(stacks, createDeployer);
    if (args.dump) {
        await writeFile(
            "sirocco.dump.json",
            JSON.stringify(
                {
                    stacks: deployments
                },
                null,
                4
            ),
            "utf8"
        );
    }
    // Ensure we have the correct order.
    return stacks.map(stack => deployments[stack]);
}

async function runDeploy(args) {
    await runStepsForDeployers(
        await getDeployers(args),
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
                deployer.printParams();
                await deployer.describeStack();
            }
        ]
    );
}

async function runTeardown(args) {
    const deployers = await getDeployers(args);
    await runStepsForDeployers(deployers.reverse(), [
        "teardown",
        async deployer => {
            await deployer.authenticate();
            await deployer.teardown();
            await deployer.waitForDeleted();
        }
    ]);
}

async function runDescribe(args) {
    await runStepsForDeployers(await getDeployers(args), [
        "get outputs",
        async deployer => {
            await deployer.authenticate();
            await deployer.describeStack();
        }
    ]);
}

async function runPreview(args) {
    const deployers = await getDeployers(args);
    await runStepsForDeployers(deployers.reverse(), [
        "preview",
        async deployer => {
            await deployer.printParams();
        }
    ]);
}

async function runFindPhysicalId(args) {
    const resources = args.resources.map(res => res.split("."));
    args.stacks = [...new Set(resources.map(path => path[0]))];
    const deployers = await getDeployers(args);
    await runStepsForDeployers(deployers.reverse(), [
        "find-physical-id",
        async deployer => {
            await deployer.getResourcePhysicalIds(
                ...resources
                    .filter(res => res[0] === deployer.targetStack)
                    .map(res => res.slice(1))
            );
        }
    ]);
}

async function runGetEvents(args) {
    await runStepsForDeployers(await getDeployers(args), [
        "get events",
        async deployer => {
            await deployer.authenticate();
            await deployer.getEvents();
        }
    ]);
}

main();
