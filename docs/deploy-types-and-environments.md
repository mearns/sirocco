# Deploy Types and Environments

Deploy Types and Environments are meant to form a hierarchy of your deploy targets, with Deploy Types
at the higher level. A Deploy Type is a class of Environments. For instance, you might have
multiple development Environments, each with different names, and put them all under the "dev"
Deploy Type. You might also have multiple production Environments (e.g., in different cloud regions),
but classify them all as part of the "prod" Deploy Type.

The recommended pattern is to define Deploy Types _first_, and then refine as needed by defining specific
Environment within those Deploy Types. All of the common configuration for all the Environments of that Type
is specified on the Deploy Type, and then you can override these for specific Environments if you need to.
Often, you'll find you don't even need to define the Environments if they can all share the same configuration.
In particular, when you use _dynamic configuration_ (see the relevant section of the [REAMDE](../README.md)), you
can have shared configuration functions that compute configuration values based on the environment name (among
other things).

## Naming

One of the goals of sirocco is to limit the amount of copy-paste you need to do to configure deploys for different
environments. For instance, you shouldn't need a different command for each environment you want to deploy, sirocco
should be smart enough, in most circumstances, to figure out which environment you're targeting. There are a number
of strategies employed to determine the Environment and Deploy Type. In order, these strategies are:

1. **User specified**: If you have explicitly specified both the Deploy Type and the Environment on the command line
   (the former with the `DEPLOY-TYPE` positional argument and the latter with the `--env` option), then these are used
   exactly as given. In particular, the given Environment name is **not validated** against the Deploy Type's
   `validEnvs` property.
2. **Specified environment**: If the Environment name has been given (with the `--env` option), but _not_ the Deploy Type,
   then the Deploy Type is taken from the Environment name as everything up to (but not including) the first dash character.
   If there are no dash-characters, then the entire Environment name is used as the Deploy Type. Note that the Environment
   name is still used _as given_ in both cases. E.g., if you specifiy `--env dev-123`, then the Deploy Type is "dev" and the
   Environment name is "dev-123". If you speciiy `--env qa`, then the Deploy Type _and_ the Environment name are both "qa".
3. **From Env Var**: If the `--env` option is not given, then the Environment name is taken from the `CI_ENVIRONMENT_NAME`
   environment variable (see note 1, below). The Expected Deploy Type is taken from the start of this Environment name
   up to but not including the first _slash_ character ("/", see note 2). If the `DEPLOY-TYPE` is specified on the command
   line, then it _must_ match the Expected Deploy Type determined in this way. If it is _not_ specified, then the Expected
   Deploy Type is used as the Deploy Type.
4. **Branch Deploy Type**: If the `DEPLOY-TYPE` is given on the command line (but the `--env` is not), _and_ it is defined
   as a branch-deploy-type (see note 3), then sirocco will attempt to determine the current version control branch name
   (see note 4). If it is able to do so, then the Environment name is contructed by joining the branch name onto the
   specified Deploy Type with a dash character ("-"). Note that the branch name will be converted to all lower-case, and
   any slash characters ("/") will be replaced with dashes ("-") before joining.
5. **Single Environment Deploy Type**: If none of the above strategies were successful (including if no branch name could
   be determined in the "Branch Deploy Type" strategy), then the `DEPLOY-TYPE` positional argument must be specified on
   the command line, and that deploy type must be configured with a `validEnvs` property defining a single valid environment
   name (see note 5), which is then used as the implied Environment name.

If none of the above strategies were able sucessfull, then the command will fail: you'll need to change your configuration or
specify additional information on the command line.

### Notes:

1. In the "From Env Var" strategy, the name of the environment variable to read from can be overridden with the `--env-name-env-var`
   configuration, "CI_ENVIRONMENT_NAME" is the default value, which is compatible with gitlab-ci.
2. Note that the character used to split the Deploy Type from the environment name in the "From Env Var" strategy (a slash "/"),
   is _different_ from that used by the "Specified environment" strategy (a dash "-"). This is based on the way that certain
   CI environments (notably gitlab-ci) format nested environments. However, the character for the "From Env Var" strategy
   only defaults to "/", it can be overriden with the `--env-name-separator` configuration.
3. The `--branch-deploy-type` configuration can be used to specify any number of Deploy Types that are considered branch-deploy-types,
   meaning that they will be subject to the Branch Deploy Type strategy above (if none of the preceding strategies work). By
   default, only "dev" is considered to be a branch-deploy-type.
4. Currently only git is supported for determining branch names; it is taken from the repository of your current working
   directory by [git-branch](https://www.npmjs.com/package/git-branch).
5. The specified Deploy Type must be defined in your sirocco configuration, and it must have a `validEnvs` property defined which
   is either a string value or an array containing exactly a single string value. E.g., we're not going to look at a RegExp and try
   to determine if there is only a single possible value that it allows.
