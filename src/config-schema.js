const { Validator } = require("jsonschema");
const { CallerError } = require("./errors");
const buildObject = require("build-object-better");

const MAGIC_PROP = Symbol("__sirocco_validator_magic__");

class MagicValue {
    constructor(type, original) {
        this[MAGIC_PROP] = type;
        Object.defineProperty(this, "original", {
            value: original,
            enumerable: false,
            writable: false
        });
    }

    unwrap() {
        return this.original;
    }
}

const validator = new Validator();
function coerceFunctions(instance, property) {
    const value = instance[property];
    if (typeof value === "function") {
        instance[property] = new MagicValue("function", value);
    } else if (value instanceof RegExp) {
        instance[property] = new MagicValue("regexp", value);
    }
}

const addSchema = (id, schema) => {
    schema.id = id;
    schema.$id = id;
    schema.$schema = "http://json-schema.org/schema#";
    validator.addSchema(schema, id);
    return id;
};

const ref = id => ({ $ref: id });

const isFunction = addSchema("/config/is-function", {
    title: "A function",
    type: "object",
    properties: {
        [MAGIC_PROP]: {
            type: "string",
            pattern: "^function$"
        }
    },
    additionalProperties: false,
    required: [MAGIC_PROP]
});

const isRegex = addSchema("/config/is-regex", {
    title: "A regular expression",
    type: "object",
    properties: {
        [MAGIC_PROP]: {
            type: "string",
            pattern: "^regexp$"
        }
    },
    additionalProperties: false,
    required: [MAGIC_PROP]
});

const stackName = addSchema("/config/stack-name", {
    type: "string",
    pattern: "^[a-zA-Z0-9_-]+$"
});

const deployType = addSchema("/config/deploy-type", {
    type: "string",
    pattern: "^[a-zA-Z0-9_-]+$"
});

const envName = addSchema("/config/env-name", {
    type: "string",
    pattern: "^[a-zA-Z0-9_-]+$"
});

const paramNames = addSchema("/config/env-name", {
    type: "string",
    pattern: "^[a-zA-Z0-9_-]+$"
});

const stringTemplate = addSchema("/config/string-template", {
    title: "string-template",
    description: "A string value that will be formatted as a string template",
    type: "string"
});

const resolvableType = addSchema("/config/resolvable-type", {
    title: "Resolvable type",
    description:
        "A value that will be resolved by the deployer: a function or a string template",
    anyOf: [ref(isFunction), ref(stringTemplate)]
});

const deployBucket = addSchema("/config/deploy-bucket", {
    title: "Deploy Bucket",
    description: "The name of an S3 deploy bucket",
    anyOf: [ref(resolvableType)]
});

const deployPrefix = addSchema("/config/deploy-prefix", {
    title: "Deploy Prefix",
    description: "An S3 object key prefix",
    anyOf: [ref(resolvableType)]
});

const authCmd = addSchema("/config/auth-command", {
    title: "Authentication command",
    anyOf: [
        ref(isFunction),
        {
            type: "string",
            title: "string command",
            description: "A command name to execute"
        },
        {
            title: "An array of command-args to execute",
            type: "array",
            items: {
                type: "string ",
                title: "A string",
                description: "The command name and arguments"
            },
            minItems: 1
        }
    ]
});

const coreArgSetSchema = {
    type: "object",
    properties: {
        deployPrefix: ref(deployPrefix),
        deployBucket: ref(deployBucket),
        authCmd: ref(authCmd),
        ...buildObject(
            ["inputTemplate", "outputTemplate", "cfnStackName", "role"],
            () => ref(resolvableType)
        ),
        tags: {
            title: "Stack Tags",
            description: "An object of tags",
            type: "object",
            required: [],
            additionalProperties: ref(resolvableType),
            propertyNames: ref(resolvableType)
        },
        capabilities: {
            type: "array",
            items: { type: "string" }
        },
        params: {
            type: "object",
            required: [],
            additionalProperties: {
                anyOf: [
                    { type: "string", title: "A string" },
                    { type: "number", title: "A number" },
                    { type: "boolean", title: "A boolean" },
                    ref(resolvableType)
                ]
            },
            propertyNames: ref(paramNames)
        }
    }
};

const argsSet = addSchema("/config/args", {
    ...coreArgSetSchema,
    additionalProperties: false,
    required: []
});

const defaultStacksAsArray = addSchema("/config/default-stacks#as-array", {
    type: "array",
    items: ref(stackName)
});

const validEnv = "/config/valid-env";
addSchema(validEnv, {
    title: "Valid Env",
    description: "Specifies how to know if an environment is valid",
    anyOf: [
        { type: "string", title: "A string" },
        ref(isRegex),
        ref(isFunction),
        {
            type: "array",
            title: "An array of possible values",
            items: ref(validEnv)
        }
    ]
});

const configSchema = {
    id: "/config",
    type: "object",
    required: [],
    additionalProperties: false,
    properties: {
        defaultStacks: {
            anyOf: [ref(defaultStacksAsArray), ref(stackName)]
        },
        global: ref(argsSet),
        deployTypes: {
            additionalProperties: {
                ...coreArgSetSchema,
                properties: {
                    ...coreArgSetSchema.properties,
                    validEnv: ref(validEnv)
                }
            },
            propertyNames: ref(deployType)
        },
        envs: {
            additionalProperties: ref(argsSet),
            propertyNames: ref(envName)
        }
    }
};

function uncoerceMagicValues(config) {
    if (Array.isArray(config)) {
        config.forEach((value, idx) => {
            config[idx] = uncoerceMagicValues(value);
        });
    } else if (config instanceof MagicValue) {
        return config.unwrap();
    } else if (typeof config === "object") {
        Object.entries(config).forEach(([key, value]) => {
            config[key] = uncoerceMagicValues(value);
        });
    }
    return config;
}

module.exports = {
    validateConfig(config) {
        const { errors } = validator.validate(config, configSchema, {
            preValidateProperty: coerceFunctions.bind(validator)
        });
        uncoerceMagicValues(config);
        if (errors.length) {
            const ce = new CallerError(
                "One or more validation errors were detected in the given config file:\n" +
                    errors
                        .map((error, idx) => `  ${idx + 1}) ${error}`)
                        .join("\n")
            );
            ce.errors = errors;
            throw ce;
        }
    }
};
