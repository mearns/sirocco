const { Validator } = require("jsonschema");
const { CallerError } = require("./errors");

const validator = new Validator();
const addSchema = (id, schema) => {
    schema.id = id;
    schema.$id = id;
    schema.$schema = "http://json-schema.org/schema#";
    validator.addSchema(schema, id);
    return id;
};

const ref = id => ({ $ref: id });

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

const coreArgSetSchema = {
    type: "object",
    properties: {
        role: { type: "string" },
        params: {
            type: "object",
            required: [],
            additionalProperties: {
                anyOf: [
                    { type: "string" },
                    { type: "number" },
                    { type: "boolean" }
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
                    validEnv: {
                        oneOf: [
                            { type: "string" },
                            { type: "array", items: "string" }
                        ]
                    }
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

module.exports = {
    validateConfig(config) {
        const { errors } = validator.validate(config, configSchema);
        if (errors.length) {
            const ce = new CallerError(
                "One or more validation errors were detected in the given config file:\n" +
                    errors
                        .map((error, idx) => `  ${idx + 1}) ${error.message}`)
                        .join("\n")
            );
            ce.errors = errors;
            throw ce;
        }
    }
};
