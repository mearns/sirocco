# Sirocco Doesn't Deploy Application Config Files

Some deploy tools allow you to deploy per-environment data files for configuring your
application to the specific environment. _Sirocco doesn't support this_. This is an intentional
choice as we haven't (so far) been able to identify any reason to do this that doesn't seem
to be an antipattern.

## How to Configure your Application per Environment

In short, use environment variables. This is what they're meant for and they can be configured through your
CloudFormation template, and therefore can be parameterized based on your deploy type and environment using
sirocco.

CloudFormation supports configuration of environment variables for all of the following resource types
(and probably others):

-   [Lambda functions](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-lambda-function.html#cfn-lambda-function-environment)
-   ECS Tasks (through [TaskDefinition.ContainerDefinitions.Environment](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-ecs-taskdefinition-containerdefinitions.html#cfn-ecs-taskdefinition-containerdefinition-environment))
-   EC2 Instances, though a UserData generated script (as explained in the first part of [this article](https://medium.com/@seb.nyberg/passing-tags-as-environment-variables-to-an-ec2-instance-12b64e69891e))

If you have a lot of configuration parameters for your app (this could be a smell, you might want to consider
why your app requires so many inputs), you could easily enough encapsulate these parameter values more directly
into your application and just use environment variables to select which set of values to use.

For instance, and NodeJS lambda function might be deployed with the following properties in the stack template:

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Parameters:
    env:
        Type: String
Resources:
    MyFunction:
        Type: AWS::Lambda::Function
        Properties:
            # ...
            Environment:
                Variables:
                    ENV: !Ref env
```

The `env` template parameter is provided by default by sirocco with the value of the deploy environmemt being
targeted. Inside your application code, you might have a module like the following to provide application config
values:

```javascript
const configByEnv = {
    nonprod: {
        param1: "param value 1-nonprod",
        param2: "param value 2-nonprod"
    },
    prod: {
        param1: "param value 1-prod",
        param2: "param value 2-prod"
    }
};
module.exports = function getConfig() {
    const env = process.env["env"];
    return configByEnv[env];
};
```

Note that this is just for illustrative purposes: your real code should probably check for unknown environments
and use something like `Object.freeze` or `Object.assign` to make sure that the shared config can't be modified
through the returned value.

For container or VM applications (like ECS services of EC2 instances), you can take the same approach, or if you
really want to pull it out of the application code, you can put it in config files named (or otherwise broken down)
by environment and bake those files into your container or VM image.

## Why Sirocco Doesn't Do This For You

A common pattern in other tools is to have environment specific application config files deployed to a data store
like S3, or perhaps even written into a database somewhere. There are two issues with this approach:

1. It decouples configuration from the change management of your application.
2. It adds unnecessary latency and availability issues for critical data.

The first item refers to the ability to change your configuration without changing your application. While this may
sound convenient, it's also risky. Most software organizations have some kind of change management in place so that
deploying new code to production requires approval (or at least an audit trail). However, changes to application
config can be just as risky as changes to application code, so they should be managed the same way. If your config
is a database table or an S3 file, it might be too easy for someone to update these outside of the normal process,
either intentionally or out of ignorance. Even if you do have a change management process in place for these configs,
there's no reason it necessarily needs to be different than the one you have for your code. By baking your configuration
into your application, they can be managed the same way.

We often think of coupling as a bad thing in Software Engineering, but things that are intimately tied together _should_
be tightly coupled so there's less risk of drift between them. Such is the case with application code and the configuration
that drives it: this configuration should generally be considered opaque outside of the application, meaning the application
is the only thing that cares about how this configuration is shaped or what it contains. When you change your application
to require a new configuration parameter, or configuration in a different shape, this change should be coupled to the
corresponding configuration change: i.e., they should be done in the same commit and deployed together. Even if the deploy
tool is the one publishing the configuration, it should be done atomically with the code deploy.

The second item simply means there's no need to have an external data store, no matter how simple, when the configuration
could be baked into your application. Why wait for an item to load from S3 if you could just require a local module? Why
risk that your database will be temporarily unreachable when you could just peek at an evironment variable?

## Considerations

Having application config baked into your application means that you can't make changes to config without deploying your
code. A common concern here is if you need to make config changes while you're in the middle of developing a feature that's
not ready to go out yet. This scenario really isn't any different than any other _hot fix_ scenario, where you have a bug in
your deployed code that needs to be be fixed _now_. If your work flow can't support deploying hot fixes to config, then it
also can't support deploying hot fixes to your code, which is not a good state to be in. Using version control branches to
manage your changes, or tagging releases and deloying from hot fix branches, should be sufficient to reasonably support both.

The other common concern is that if you have a long build or deploy pipeline, your configuration will have to wait for that
before it can be deployed. This is true, and it's not a bad thing: assuming your pipeline is testing your application, it
_should_ be running those same tests to make sure it works with the configuration changes. If your pipeline takes too long,
that's a separate issue: again, if you need to deploy a hot fix for a critical bug, you'll be in the exact same position.

Lastly, this approach means that every instance has configuration for every environment. If any of these parameters are
considered secure, than that might be a problem. On the other hand, application config probably isn't a good place to store
secure information any way; you'll probably want to use something like SSM Parameter Store or some other kind of secret
manager.

If you're concerned that including the extra configuration is too much bloat for each instance to hang onto, this could be
another indication that you have too many configuration parameters: if the size of config files is really that large compared
to your application code, you might want to think about why your application requires so many parameters.
