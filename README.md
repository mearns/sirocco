# sirocco

A node command line utility and library to assist in deploying AWS CloudFormation stacks.

Deploying any non-trivial CloudFormation stack requires managing parameter values,
stack names, tags, etc. When any of this is dynamic, like when deploying to multiple
environments/stages, sticking these commands in `package.json` isn't very practical.

Sirocco manages one or more stacks across multiple environments, generating commands,
parameter values, stack names, etc., based on a simple (and optional) configuration
file.

The "Quick Start" below is meant as a quick reminder for when you already know how to
use this package; to actually get started, take a look at [Getting Started](docs/getting-started.md).

## Requirements

This requires the [AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-install.html)
be installed and executable from your path.

Currently, only YAML is supported from CloudFormation stack templates.

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

```ASCII
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

### Async Configuration Module

If your config file exports a function, instead of an object, it will be invoked without any arguments
and treated as an `async` function. This allows your config module to do asynchronous things like read
from file before returning the actual sirocco config object.

### Dynamic Configuration

Parameters and most of configuration options are resolved dynamically for each stack and environment, so a single
configuration object can provide dynamic values based on the stack or environment name. The following shows
some example of dynamic parameters:

```javascript
module.exports = {
    global: {
        params: {
            constant: "value",

            foo: (stackName, envName, parameters) => {
                /* derive the value of the "foo" parameter for this stack/env */
            },

            bar:
                "The bar parameter value for stack {stack} in the {env} environment",

            baz: "Derived-From-Other-Params-{constant}",

            trot: () => "A parameter value with literal brackets in it: {foo}"
        }
    }
};
```

As shown, dynamic parameter values can either be functions (as in "foo" and "trot", above) or string templates
(as in "bar" and "baz").

#### Functions

Functions are invoked with three parameters:

-   The name of the stack being targeted (see below)
-   The name of the environment
-   A dictionary of _unresolved_ parameters.

Note that the first argument, the name of the stack, is the _local_ name of the stack (i.e., the name of the stack's
directory under `stacks/`), _not_ the generated name of the cloudformation stack.

The third argument is a dictionary (a plain object) of the parameters for the stack, _without_ resolving any of
the parameter values. Thus, e.g., the "foo" property of this dictionary, in the above examples, would be the `foo` function
itself, _not_ the resulting value.

The dictionary is _first_ populateed with two items: _stack_ and _env_, which are the same as the values passed in for the first
two arguments. However, you happen to have parameters named "stack" or "env", then these entries will be overwritten in the dictionary
with the (unresolved) parameter values.

#### String Templates

String values are assumed to be [string-templates](https://www.npmjs.com/package/string-template) which use curly braces
to denote place holders to be replaced. These templates are resolved with the same dictionary that is passed as the third
argument to function values (described above), which is the unresolved parameter values with the added default properties
of _stack_ and _env_.

If your parameter value has literal pairs of curly braces that you want to include in the value, you can escape them by
doubling the braces. You can also make it unambiguous by defining the value as a function which returns the string value you
want: returned value are _never_ treated as string-templates.
