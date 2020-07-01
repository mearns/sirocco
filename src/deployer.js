/**
 * The `Deployer` class is what generates the commands for working with a stack. It's configured with the
 * target stack (i.e., the name of the directory under `stacks/` that contains your stack), the name of the
 * environment to deploy to, a set of additional configurations to control the deploy (e.g,. the name to use
 * for the cloudformation stack), and then the dictionary of parameter values to deploy the stack with.
 *
 * A number of the options that the Deployer can take are called _resolvable_, which basically means they
 * can be auto-interpolated by the deployer based on parameter values and other values specific to the instance.
 * This makes it easy to re-use the same value for different stacks and environments and avoid duplicating
 * values all over the place. See the `resolveValue` function, below, for more details.
 */
const path = require("path");
const format = require("string-template");
const justRunIt = require("just-run-it");
const mkdirp = require("mkdirp");
const chalk = require("chalk");
const { CallerError } = require("./errors");
const buildObject = require("build-object-better");
const { log, open, close, logPastDate } = require("./logger");
const url = require("url");

/**
 * The default value that's used for the CFN stack name. The default value
 * will produce stacknames like "{{targetStack}}-{{envName}}"
 *
 * @param {*} targetStack
 * @param {*} envName
 */
const DEFAULT_STACK_NAME_GENERATOR = (targetStack, envName) => {
    return `${targetStack}-${envName}`;
};

/**
 * The default value for determining the input cloudformation template
 * file for deploying a stack. The default value is "stacks/{{targetStack}}/stack.yml".
 *
 * @param {String} targetStack
 */
const DEFAULT_INPUT_TEMPLATE = targetStack => {
    return path.join("stacks", targetStack, "stack.yml");
};

/**
 * The default value for the path to the cloudformation output template file, which is
 * produced by packaging the input template.
 * The default value is "build/stacks/{{targetStack}}/{{envName}}/stack.yml".
 *
 * @param {String} targetStack
 * @param {String} envName
 */
const DEFAULT_OUTPUT_TEMPLATE = (targetStack, envName) => {
    return path.join("build", "stacks", targetStack, envName, "stack.yml");
};

/**
 * The default value for the prefix to use for S3 deploy artifacts.
 * The default value is "{{targetStack}}/{{envName}}.yml".
 *
 * @param {String} targetStack
 * @param {String} envName
 */
const DEFAULT_DEPLOY_BUCKET_PREFIX = (targetStack, envName) => {
    return `${targetStack}/${envName}`;
};

/**
 * Given a config or param value for a `Deployer`, resolves it to a raw value.
 * Value can be either a String, a function, or a raw value.
 *
 * A String
 * will be formatted using string-templates with a dictionary of values described
 * below. E.g., the value `"{stack}-xyz"` will result in the name of the targetStack,
 * followed by a suffix of "-xyz".
 *
 * A function will be invoked with three values: the name of the stack (the local short name, i.e., the "target stack",
 * not the cloudformation stack name), the environment name, and the dictionary that
 * is passed to string templates, as described below. If you want to use a string that
 * looks like a string template, but don't actually want to format it with string-template,
 * then use a function that returns the string.
 *
 * Any other value is returned as is.
 *
 * The dictionary used for formatting string templates, and passed as the third argument
 * to function values, is shallowly-copied from `params`, with two added properties
 * _if not already present_: `stack` and `env`, which are the values of the `targetStack`
 * and `envName` parameters, respectively.
 *
 * @param {*|String|function} value The value to resolve.
 * @param {String} targetStack The name of the stack being targeted.
 * @param {String} envName The name of the environment being targets.
 * @param {Object} params An object mapping parameters for the stack template.
 */
function resolveValue(value, targetStack, envName, params) {
    const dict = {
        stack: targetStack,
        env: envName,
        ...params
    };
    if (typeof value === "function") {
        return value(targetStack, envName, dict);
    }
    if (typeof value === "string") {
        return format(value, dict);
    }
    return value;
}

class Deployer {
    /**
     * Note: Parameters of type `resolvable` means they will be processed through the `resolveValue` function.
     * All such values should resolve to a string.
     *
     * @param {String} targetStack The local name of the stack to deploy.
     * @param {String} envName The name of the target deploy environment.
     * @param {Object} config Configuration values for the deployer.
     * @param {resolvable} config.deployBucket The name of the S3 bucket to which deploy artifacts will be copied.
     *  This bucket must already exist.
     * @param {resolvable} [config.deployBucketPrefix] The prefix ("directory") to use for deploy artifacts that
     *  are copied to the deployBucket in S3. This doesn't need to already exist in the bucket, it will be "created"
     *  as needed. The default is specified by `DEFAULT_DEPLOY_BUCKET_PREFIX`.
     * @param {resolvable} [config.role="default"] The name of the AWS profile to use for authenticating before running cloudformation
     *  commands. The `AWS_PROFILE` environment variable will be set to this before running relevant commands.
     *  It will also be passed to the `authenticationCommand` if that is a function. The default value if "default".
     * @param {String} [config.envNameParamName="env"] Note: this is **not** a resolvable, it is used as given. This specifies
     *  the name of the CloudFormation param to which the target deploy environment (i.e., `envName`) will be assigned for
     *  deploying your CloudFormation template. The default is "env".
     * @param {resolvable} [config.cfnStackName] The name for the cloudformation stack that is created/updated by the deploy.
     *  The default is `DEFAULT_STACK_NAME_GENERATOR`.
     * @param {resolvable} [config.inputTemplate] The path to the input cloudformation template file. This will be processed
     * through the cloudformation `package` command by the `prepare` function, which generates the output template. This step
     * does things like upload artifacts (such as local code for Lambda Functions) to S3, and replace the corresponding references
     * in your template with the S3 location of the uploaded artifact. The default value is `DEFAULT_INPUT_TEMPLATE`.
     * @param {resolvable} [config.outputTemplate] The path to the output cloudformation template file. This is the file that
     * is generated with the cloudformation `package` command by the `prepare` function, and also the target template file for
     * deploying the stack. The default value is `DEFAULT_OUTPUT_TEMPLATE`.
     * @param {Object|function} [config.stackTags={}] A dictionary of tags to apply to the cloudformation stack. If an Object,
     * then the property names _and_ property values will be resolved with `resolveValue`. If it's a function, it will be invoked
     * with the targetStack, the envName, and the resolved dictionary of stack parameters. The returned value will be used as
     * is and not further processed. Default is an empty dictionary.
     * @param {String|function|null} [config.authenticationCommand=null] Specifies the command to use to authenticate to
     * AWS before running aws commands. If a string, it will be executed _as is_: it is *not* a resolvable value. The resolved `role`
     * will be assigned to the `AWS_PROFILE` env var during execution. If a function,
     * it will be invoked with multiple arguments: the targetStack, the envName, and then a dictionary with the following properties:
     * `dryRun`: a boolean indicating whether or not this is a dry run; `role`: the resolved value of `role`; `execute`: a bound reference
     * to `this.execute`, which can be used to run arbitrary commands. If null, no authentication will be performed.
     * @param {Array<String>} [config.capabilities=[]] An array of Strings giving the special capabilities that are required by CloudFornation
     * to deploy or update your stack. This is _not_ a resolvable argument. See <https://docs.aws.amazon.com/cli/latest/reference/cloudformation/deploy/index.html>
     * for details.
     * @param {Object} [params] Optional: an object of stack parameters to use for the deploy. Values _only_ will be resolved through
     * `resolveValue`. In addition to this values, the targeted deploy envName is assigned into a param as specified by the
     * `envNameParamName` config property (defaults to "env"). Note that if the given params specifies a conflicting value for this
     * parameter, the value in `params` takes precedence.
     */
    constructor(
        targetStack,
        envName,
        {
            deployBucket,
            deployBucketPrefix = DEFAULT_DEPLOY_BUCKET_PREFIX,
            role = "default",
            envNameParamName = "env",
            stackNameParamName = "stack",
            cfnStackName = DEFAULT_STACK_NAME_GENERATOR,
            inputTemplate = DEFAULT_INPUT_TEMPLATE,
            outputTemplate = DEFAULT_OUTPUT_TEMPLATE,
            stackTags = {},
            authenticationCommand = null,
            capabilities = [],
            dryRun = false
        },
        params = {}
    ) {
        this.targetStack = targetStack;
        this.envName = envName;
        this.parameters = {};

        if (!this.targetStack) {
            throw new CallerError("Target stack not specified");
        }
        if (!this.envName) {
            throw new CallerError("Environment name not specified");
        }

        const localResolve = value =>
            resolveValue(value, targetStack, envName, this.parameters);
        this.parameters = {
            [envNameParamName]: this.envName,
            [stackNameParamName]: this.targetStack,
            ...buildObject(Object.keys(params), paramName =>
                localResolve(params[paramName])
            )
        };
        this.authenticationCommand = authenticationCommand;
        this.inputTemplate = localResolve(inputTemplate);
        this.outputTemplate = localResolve(outputTemplate);
        this.cfnStackName = localResolve(cfnStackName);
        this.outputDir = path.dirname(this.outputTemplate);
        this.deployBucket = localResolve(deployBucket);
        this.deployBucketPrefix = localResolve(deployBucketPrefix);
        this.role = localResolve(role);
        [
            "inputTemplate",
            "outputTemplate",
            "cfnStackName",
            "deployBucket",
            "deployBucketPrefix",
            "role"
        ].forEach(propName => {
            const value = this[propName];
            if (value == null || value.length === 0) {
                throw new CallerError(
                    `Resolved value for ${propName} cannot be empty or null`
                );
            }
        });
        this.capabilities = capabilities;
        this.dryRun = dryRun;
        this.stackTags =
            typeof stackTags === "function"
                ? stackTags(targetStack, envName, this.parameters)
                : buildObject(
                      Object.entries(stackTags),
                      ([tagName]) => localResolve(tagName),
                      (key, idx, keys, [tagName, tagValue]) =>
                          localResolve(tagValue)
                  );
    }

    toString() {
        return `[Deployer: ${this.targetStack}@${this.envName}]`;
    }

    /**
     * Helper function to invoke a command.
     */
    async execute(command, options = {}) {
        try {
            const result = await justRunIt(command, {
                ...options,
                env: {
                    AWS_PROFILE: this.role,
                    ...options.env
                },
                dryRun: options.dryRun || this.dryRun
            });
            return result;
        } catch (error) {
            const errorMessage = `An error occurred running a ${
                command[0]
            } command: ${options.quiet ? `${error.stderr}\n\n` : ""}${
                error.message
            }`;
            const ce = new CallerError(errorMessage);
            ce.stack = error.stack;
            ce.command = command;
            throw ce;
        }
    }

    /**
     * Called to authenticate before running relevant commands.
     */
    async authenticate() {
        if (this.authenticationCommand) {
            if (typeof this.authenticationCommand === "function") {
                await this.authenticationCommand(
                    this.targetStack,
                    this.envName,
                    {
                        execute: this.execute.bind(this),
                        role: this.role,
                        dryRun: this.dryRun
                    }
                );
            } else if (Array.isArray(this.authenticationCommand)) {
                await this.execute(this.authenticationCommand);
            } else {
                await this.execute([this.authenticationCommand]);
            }
        }
    }

    async prepare() {
        await mkdirp(this.outputDir);
        await this.execute([
            "aws",
            "cloudformation",
            "package",
            "--template-file",
            this.inputTemplate,
            "--s3-bucket",
            this.deployBucket,
            "--s3-prefix",
            this.deployBucketPrefix,
            "--output-template-file",
            this.outputTemplate
        ]);
    }

    async deploy() {
        await this.execute([
            "aws",
            "cloudformation",
            "deploy",
            "--template-file",
            this.outputTemplate,
            "--stack-name",
            this.cfnStackName,
            ...(this.capabilities.length ? ["--capabilities"] : []),
            ...this.capabilities,
            "--no-fail-on-empty-changeset",
            ...(Object.keys(this.parameters).length
                ? ["--parameter-overrides"]
                : []),
            ...Object.entries(this.parameters).map(
                ([name, value]) => `${name}=${value}`
            ),
            ...(Object.keys(this.stackTags).length ? ["--tags"] : []),
            ...Object.entries(this.stackTags).map(
                ([name, value]) => `${name}=${value}`
            )
        ]);
    }

    async getEvents() {
        const processOutput = await this.execute(
            [
                "aws",
                "cloudformation",
                "describe-stack-events",
                "--stack-name",
                this.cfnStackName
            ],
            {
                quiet: true
            }
        );
        if (!this.dryRun) {
            const { StackEvents: events = [] } = JSON.parse(
                processOutput.stdout
            );
            if (events.length) {
                events.forEach(
                    ({
                        Timestamp: time,
                        LogicalResourceId: logicalResource,
                        ResourceStatus: status,
                        ResourceStatusReason: reason
                    }) => {
                        console.log(
                            `${chalk.gray(`${time}`)} (${chalk.yellow(
                                logicalResource
                            )}): ${status}${reason ? ` - ${reason}` : ""}`
                        );
                    }
                );
            } else {
                console.log(`${chalk.gray("<none>")}`);
            }
        }
    }

    async getResourcePhysicalIds(...logicalIdPaths) {
        const allResources = await Promise.all(
            logicalIdPaths.map(async logicalIds => {
                let physicalId = this.cfnStackName;
                let logicalPath = logicalIds.join(".") || "<stack>";
                while (!this.dryRun && logicalIds.length) {
                    const logicalId = logicalIds.shift();
                    const processOutput = await this.execute(
                        [
                            "aws",
                            "cloudformation",
                            "describe-stack-resource",
                            "--stack-name",
                            physicalId,
                            "--logical-resource-id",
                            logicalId
                        ],
                        { quiet: true }
                    );
                    ({ PhysicalResourceId: physicalId } = JSON.parse(
                        processOutput.stdout
                    ).StackResourceDetail);
                }
                return [logicalPath, physicalId];
            })
        );
        open("Physical IDs");
        allResources.forEach(([logicalIdPath, physicalId]) => {
            log(logicalIdPath, physicalId);
        });
        close();
    }

    async describeStack() {
        const processOutput = await this.execute(
            [
                "aws",
                "cloudformation",
                "describe-stacks",
                "--stack-name",
                this.cfnStackName
            ],
            {
                quiet: true
            }
        );
        if (!this.dryRun) {
            const [
                {
                    Outputs: outputs = [],
                    LastUpdatedTime: updateTimeString,
                    StackStatus: status,
                    StackStatusReason: reason,
                    StackId: stackId
                }
            ] = JSON.parse(processOutput.stdout).Stacks;
            const updateTime = updateTimeString && new Date(updateTimeString);
            logPastDate("Update Time", updateTime);
            log("Status", status, reason);
            log("Stack ID", stackId);
            log("Console URL", this.getCloudformationConsoleURL(stackId));
            open("Outputs");
            if (outputs.length) {
                outputs.forEach(({ OutputKey: key, OutputValue: value }) => {
                    log(key, value);
                });
            }
            close();
        }
    }

    printParams() {
        log("Cloudformation Stack Name", this.cfnStackName);
        open("Params");
        if (Object.keys(this.parameters).length) {
            Object.entries(this.parameters).forEach(([name, value]) => {
                log(name, value);
            });
        }
        close();
    }

    async teardown() {
        await this.execute([
            "aws",
            "cloudformation",
            "delete-stack",
            "--stack-name",
            this.cfnStackName
        ]);
    }

    getCloudformationConsoleURL(stackArn) {
        return new url.URL(
            `https://console.aws.amazon.com/cloudformation/home#/stacks/stackinfo?stackId=${stackArn}`
        );
    }

    async waitForDeleted() {
        const stackData = await this.waitForStatus(
            status => status !== "DELETE_IN_PROGRESS"
        );
        logPastDate("Deletion Time", new Date(stackData.DeletionTime));
    }

    async waitForStatus(checkCompleted) {
        return new Promise((resolve, reject) => {
            let checkCount = 0;
            let stackId = null;
            const checkStatus = async () => {
                try {
                    const processOutput = await this.execute(
                        [
                            "aws",
                            "cloudformation",
                            "describe-stacks",
                            "--stack-name",
                            stackId || this.cfnStackName
                        ],
                        {
                            quiet: true,
                            silent: checkCount > 1
                        }
                    );
                    if (this.dryRun) {
                        resolve();
                    } else {
                        const [stack] = JSON.parse(processOutput.stdout).Stacks;
                        const {
                            StackStatus: status,
                            StackStatusReason: reason,
                            StackId: newStackId
                        } = stack;
                        const done = await checkCompleted(status, checkCount);
                        if (checkCount % 3 === 0 || done) {
                            log("Status", status, reason);
                        }
                        stackId = newStackId;
                        checkCount++;
                        if (done) {
                            log("Stack ID", stackId);
                            log(
                                "Console URL",
                                this.getCloudformationConsoleURL(stackId)
                            );
                            resolve(stack);
                        } else {
                            setTimeout(checkStatus, 5000);
                        }
                    }
                } catch (error) {
                    reject(error);
                }
            };
            checkStatus();
        });
    }
}

module.exports = Deployer;
