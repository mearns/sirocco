# sirocco

A node command line utility and library to assist in deploying AWS CloudFormation stacks.

## Quick Start

### install

```console
> npm install --save-dev sirocco
```

### Basic CLI Usage

```console
> sirocco (deploy|teardown) [DEPLOY_TYPE] [options]
```

### Directory Layout

```
./
└── stacks/
    ├── queue/
    │   └── stack.yml
    ├── lambda/
    │   └── stack.yml
    └── test/
        └── stack.yml
```

## Config

Specify optional config at `.sirocco.js`:

```js
module.exports = {
    options: {
        /* command-line-ish options */
    },

    // The default set of stacks to deploy if none are specified with the --stacks option.
    defaultStacks: ["queue", "lambda"],

    // Base configuration shared by all deploy types and envs.
    global: {
        params: {
            suite: "Sirocco",
            app: "SiroccoDemo",
            isTest: false
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
    },

    envs: {
        "dev-test": {
            params: {
                isTest: true
            }
        }
    }
};
```
