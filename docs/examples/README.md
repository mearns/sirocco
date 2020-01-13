# Examples

## Example 1

```javascript
// Sirocco generally needs a deploy bucket in S3 for the aws cli tool to copy deploy resources to (e.g., Lambda code)
// You'll have to create these buckets out of band, but they will typically just be a one-time setup and shared
// by all the projects in your account (or at least your app suite).
const NONPROD_DEPLOY_BUCKET = "shared-non-prod-deploy-bucket";
const PROD_DEPLOY_BUCKET = "shared-prod-deploy-bucket";

// The names of the AWS role/profile that sirocco will use to run the aws cli commands.
const NONPROD_ROLE = "non-prod-admin";
const PROD_ROLE = "prod-admin";

// For npm projects, pull information out of the package.json file, instead of repeating it here.
// This assumes your package name is scoped with the name of your application-suite, if you have one.
// E.g., "@sirocco/hypothetical-web-component".
const packageInfo = require("./package.json");
const [, SUITE_NAME, APP_NAME] = /@([^/]+)\/(.*)/.exec(packageInfo.name);
const VERSION = packageInfo.version;

// This is the sirocco configuration object.
module.exports = {
    // This is shared across all stacks, deployTypes, and environments, unless
    // overridden in a deployType or environment.
    global: {
        // The S3 object prefix that will be used for any resources the aws copies to your deploy bucket.
        deployPrefix: (stack, env) => `${APP_NAME}/${env}/${stack}`,

        // The name of the cloudformation stack that will be created/updated by sirocco.
        cfnStackName: (stack, env) => `${APP_NAME}-${env}-${stack}`,

        // Tags to put on the cloudformation stack.
        tags: {
            "cust:suite": SUITE_NAME,
            "cust:app": APP_NAME,
            "cust:appStack": stack => `${APP_NAME}:${stack}`,
            "cust:appVersion": `${APP_NAME}:${VERSION}`,
            "cust:env": (stack, env) => env
        },

        // Default values that sirocco will specify for cloudformation template parameters.
        // these can be overridden individually at the deployType and env level as needed.
        params: {
            // Probably the same everywhere
            suite: SUITE_NAME,
            app: APP_NAME,
            version: VERSION,

            // Likely to be overridden
            logLevel: "INFO",
            nodeEnv: "production"
        }
    },

    deployTypes: {
        // Our dev environment is a branch-deploy-type, so sirocco can look at your git branch
        // name to determine the environment name if you don't specify it. E.f., `sirocco deploy dev`,
        // with a branch name of "ABC-123-foobar" will end up with an environment name of "dev-abc-123-foodbar".
        dev: {
            // Our branches are named prefixed with JIRA tickets like ABC-1234, or something similar, so the env-names
            // will include those as well.
            validEnvs: /dev-[a-z]+-[0-9]+(?:-[a-z0-9][a-z0-9_-]*)?/,
            deployBucket: NONPROD_DEPLOY_BUCKET,
            role: NONPROD_ROLE,

            // Override some of the default params (from the "global" section above) for all envs in this deploy-type.
            params: {
                logLevel: "DEBUG",
                nodeEnv: "development"
            }
        },

        // Multiple QA environments are used for testing. E.g., we might have a "qa-manual-01" and "qa-manual-02"
        // enviornment for two different testers to use for manual testing, plus a "qa-regression" and "qa-nightly"
        // environment for various phases of automated testing.
        qa: {
            validEnvs: /qa-[a-z0-9_-]+/,
            deployBucket: NONPROD_DEPLOY_BUCKET,
            role: NONPROD_ROLE,
            params: {
                logLevel: "DEBUG"
            }
        },

        // Our integration environment(s) that other teams can use for testing without impacting our production environments.
        int: {
            validEnvs: /int-[a-z0-9_-]+/,
            deployBucket: PROD_DEPLOY_BUCKET,
            role: PROD_ROLE,
            params: {
                // We use DEBUG level logging so we can help integrating apps debug problems (as well as debug our own problems)
                logLevel: "DEBUG"
            }
        },

        // Our production environments.
        prod: {
            validEnvs: /prod-[a-z0-9_-]+/,
            deployBucket: PROD_DEPLOY_BUCKET,
            role: PROD_ROLE
        }
    }
};
```
