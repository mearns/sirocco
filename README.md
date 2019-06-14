# sirocco

A node library to assist in deploying cloudformation stacks.

## Config

Specify optional config at `.sirocco.js`.

```js
module.exports = {
    // The default set of stacks to deploy if none are specified on the command line.
    defaultStacks: ["stack1", "stack2"],

    // Base configuration shared by all deploy types and envs.
    global: {
        params: {
            suite: "Sirocco",
            app: "SiroccoTest"
        }
    },

    // A dictionary of known deploy types.
    deployTypes: {
        dev: {
            validEnvs: /dev-[a-z0-9-]+/,
            role: "NONPROD_ROLE",
            params: {
                nodeEnv: "development"
            }
        },
        prod: {
            role: "PROD_ROLE",
            validEnvs: /prod-[0-9]+/,
            params: {
                nodeEnv: "production"
            }
        }
    }
};
```
