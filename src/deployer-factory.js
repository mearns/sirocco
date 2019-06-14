/**
 * The deployer factory builds on top of the basic `Deployer` model with the concept of pre-configured
 * _deploy types_. A deploy type is more general than an environment, and there could be more than one
 * environment of the same deploy type (though each environment has exactly one deploy type).
 *
 * Environment names are typically a series of specifiers, joined by "-" characters. The specifiers
 * start generally, beginning with the deploy type, and increase specificity from there. For instance,
 * you might have "staging-01", or "dev-ticket123-jdoe", etc.
 *
 * This also utilizes the concept of cascading configs: deployer configuration is loaded from config
 * for the deployType first, then overwritten with config for the environment, and lastly with
 * command line arguments.
 */
const { createDeployer } = require("./cli-helper");
const { CallerError, ConfigError } = require("./errors");
const getGitBranch = require("git-branch");
const merge = require("lodash.merge");
const { logNamedValue } = require("./logger");

/**
 * Given command line arguments, determine the deploy type and the specific
 * environment name.
 *
 * A series of strategies are tried for this:
 *
 * 1. If the `env` and `DEPLOY-TYPE` are both given in the `args`, they are used.
 * 2. If the `env` is given in the `args`, but not the `DEPLOY-TYPE`, the given
 *    environment name is split at the first "-" character and the prefix is used
 *    as the deploy type. If the env has no "-", then the entire thing is used as the deploy type.
 * 3. If the `env` is not given in the `args`, then we look for it in the environment variables,
 *    at the env var named by the `envNameEnvVar` args property. The expected deploy type for
 *    this env is taken as the first prefix when split by the `envNameSeparator`. If the
 *    `DEPLOY-TYPE` arg is given, then it must match the deploy type that was determined
 *    from the env name, or an Error is thrown. If `DEPLOY-TYPE` is not given, the one determined
 *    from the env name is used.
 * 4. If the `DEPLOY-TYPE` arg is given _and_ is included in the `branchDeployType` arg: we attempt
 *    to get the name of the GIT branch in the current directory. If we can find it, then the environment
 *    name is constructed from the `DEPLOY-TYPE` and the branch name, joined with "-". The branch name
 *    is converted to all lowercase and any "/" characters are replaced with "-" characters.
 * 5. If the `DEPLOY-TYPE` arg is given and there is a configuration for it in `deployTypes`, and
 *    the configuration for it has exactly one `validEnv` value (either a String, or an Array of length 1),
 *    then that value is used as the env name.
 *
 * If none of the above strategies is successful, an error is thrown.
 *
 * @param {Object} args
 * @param {Object} deployTypes A dictionary of deploy type configurations.
 */
async function getDeployTypeAndEnv(
    { env, deployType, envNameEnvVar, envNameSeparator, branchDeployType },
    deployTypes
) {
    // If both are given, just use them.
    if (env && deployType) {
        return [deployType, env, "from DEPLOY-TYPE arg", "from --env option"];
    }
    // env is given, but not deploy type, so the deploy type should be the first part of the env.
    if (env) {
        const [deployType] = env.split("-", 1);
        return [deployType, env, "from environment name", "from --env option"];
    }
    // env name is not given in args, see if it's in the specified environment variable.
    if (process.env[envNameEnvVar]) {
        const ciEnvName = process.env[envNameEnvVar];
        const envNameParts = ciEnvName.split(envNameSeparator);
        const [expectedDeployType] = envNameParts;
        if (deployType && deployType !== expectedDeployType) {
            throw new CallerError(
                `Environment name does not match given deploy type: ${ciEnvName}`
            );
        }
        return [
            expectedDeployType,
            envNameParts.join("-"),
            deployType ? "from DEPLOY-TYPE arg" : "from environment name",
            `from environment variable (${envNameEnvVar})`
        ];
    }
    // env name not given, and not in env var. If the deploy type is given and it's listed as a branch
    // deploy type, then we can try to get the env name from the branch name.
    if (deployType && branchDeployType.indexOf(deployType) >= 0) {
        try {
            const brName = await getGitBranch();
            return [
                deployType,
                `${deployType}-${brName.toLowerCase().replace("/", "-")}`,
                "from DEPLOY-TYPE arg",
                "from GIT branch name"
            ];
        } catch (error) {
            throw new Error(
                `Git branch name could not be determined, and ${envNameEnvVar} not set`
            );
        }
    }
    // Still haven't found the env name: if we have the deploy type, and that deploy type only has
    // one valid env name, then use it.
    if (deployType) {
        if (
            deployTypes &&
            deployTypes[deployType] &&
            deployTypes[deployType].validEnvs
        ) {
            const validEnvs = deployTypes[deployType].validEnvs;
            if (Array.isArray(validEnvs) && validEnvs.length === 1) {
                const [env] = validEnvs;
                return [
                    deployType,
                    env,
                    "from DEPLOY-TYPE arg",
                    "only one valid env name for deploy type"
                ];
            }
            if (typeof validEnvs === "string") {
                return [
                    deployType,
                    validEnvs,
                    "from DEPLOY-TYPE arg",
                    "only one valid env name for deploy type"
                ];
            }
        }
        throw new CallerError(
            "Could not autmatically determine environment name from DEPLOY-TYPE. Consider using the --env option"
        );
    }
    throw new CallerError(
        "Could not autmatically determine environment name. Consider specifying the DEPLOY-TYPE, or use the --env option"
    );
}

/**
 * Given a deploy type config and an environment name, check that the environment name is valid according to
 * the config's `validEnv` property. If there is no `validEnv` property, then any env var is considered valid.
 *
 * @see runEnvNameValidator
 * @param {*} deployTypeConfig
 * @param {*} env
 */
function checkForValidEnv(deployTypeConfig, env) {
    const validEnvs = deployTypeConfig.validEnvs;
    if (validEnvs) {
        return runEnvNameValidator(validEnvs, env);
    }
    return true;
}

/**
 * Given a environment name validator, check to see if the given environment name satisfies it.
 * Initially, `envNameValidator` will come from the `validEnvs` property of a deploy type config.
 * This value may be a collection of validators, which will cause this function to be called recursively.
 *
 * @param {function|String|RegExp|Array<function>|Array<String>|Array<RegExp>} envNameValidator The validator.
 * @param {*} env
 */
function runEnvNameValidator(envNameValidator, env) {
    if (typeof envNameValidator === "function") {
        try {
            return envNameValidator(env);
        } catch (error) {
            const ce = new ConfigError(
                `An error occurred running the deploy-type "validEnvs" function: ${error.message}`
            );
            ce.stacks = error.stack;
            throw ce;
        }
    } else if (typeof envNameValidator === "string") {
        return env === envNameValidator;
    } else if (Array.isArray(envNameValidator)) {
        return envNameValidator.some(ve => runEnvNameValidator(ve, env));
    } else if (envNameValidator instanceof RegExp) {
        return envNameValidator.test(env);
    }
}

/**
 * Given a dictionary of command line args, gets a deployer factory that can be used to
 * create Deployers for any target stack and env.
 */
module.exports = async function getDeployerFactory(args) {
    const config = args.config;
    const [
        deployType,
        env,
        deployTypeFromWhere,
        envNameFromWhere
    ] = await getDeployTypeAndEnv(args, config.deployTypes);
    logNamedValue("Deploy Type", env, envNameFromWhere);
    logNamedValue("Target Environment", deployType, deployTypeFromWhere);

    const deployTypeConfig = (config.deployTypes || {})[deployType] || {};
    if (config.deployTypes) {
        if (!config.deployTypes.hasOwnProperty(deployType)) {
            throw new CallerError(
                `No such deploy type defined in config: ${deployType}`
            );
        }
        if (!checkForValidEnv(config.deployTypes[deployType], env)) {
            throw new CallerError(
                `Environment is not valid for specified deploy type: ${env}`
            );
        }
    }
    const globalConfig = config.global || {};
    const envConfig = (config.envs || {})[env] || {};
    const finalArgs = merge(
        {},
        globalConfig,
        deployTypeConfig,
        envConfig,
        args,
        { env }
    );
    return stackName =>
        createDeployer({ ...finalArgs, targetStack: stackName });
};
