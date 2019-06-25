# Commands

Sirocco is primarily a command line utility. There are two core commands: `deploy` and `teardown`.
The `deploy` command will create or update your stacks by deploying them to CloudFormation. The
`teardown` command will delete your stacks from CloudFormation (and, generally, the resources
managed by them).

Keep in mind that this is fundamentally just a command line generator: it executes command for
the AWS command line interface tool.

The general format for these commands is:

```console
> sirocco <command> [DEPLOY_TYPE] [options]
```

Below are a few other common command patterns (we'll use the `deploy` command in these examples,
but they apply as well with the `cleanup` command):

Specify an environment name with the `--env` option. In general, the DEPLOY_TYPE can be determined
from the environment name. In this case, it would be the "dev".

```console
> sirocco deploy --env dev-bmearns
```

While we're on the topic of dev deploys, deploy types configured as _branch deploys_ (e.g., with the
`--branch-deploy-type` option) can generate an environment name automatically from your git branch name.
The "dev" deploy type is a branch deploy type by default.

```console
# on git branch "bmearns-123", will deploy to "dev-bmearns-123" environment
> sirocco deploy dev
```

In a continuous integration system, like gitlab-ci, you might get the environment name
(and with it, the DEPLOY_TYPE, as above), from an environment variable. The default environment variable
is `CI_ENVIRONMENT_NAME`, which works for gitlab-ci (you can specify an alternative environment variable
name with the `--env-name-env-var` option).

```console
# With CI_ENVIRONMENT_NAME set, e.g., to dev-bmearns
> sirocco deploy
```

If you use a config file, you can specify the `defaultStacks` to deploy, but you can also target a
specific set of stacks to deploy with the `--stack` option. With no `defaultStacks` config, the
`--stack` option is required.

```console
> sirocco deploy --stack lambda --stack test
```
