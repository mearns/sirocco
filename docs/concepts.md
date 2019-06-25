# sirocco concepts

There are three key concepts in sirocco: _stacks_, _environments_, and _deploy types_.

A **stack** is simply a CloudFormation stack template. It's referred to locally by a
_local name_. Each stack is defined by it's own YAML template file, typically in a directory
named with the stack's _local name_, which is itself under the `stacks/` directory.

An **environment** is a target deployment of your stacks. For instance, a fairly simple
but common setup is to have a non-prod environment where you can deploy for testing, and
a production environment where the "real thing" is deployed once it's ready for
use. A slightly more complex setup might also have a QA environment for automated integration
tests, for instance, and a test environment that other software can use to develop against.

More complex arrangements, especially when teams are involved, might use a large number of
environments, even a dynamic set of environments. For instance: each developer might have their
own non-prod environment; QA environments might be spun up and torn down as tests are run,
etc.

In these cases in particular, it's useful to group your environments into different
**deploy types**. For instance, if you have multiple developers and they each have their
own environment, you might consider them all to be of the "dev" deploy type, while the
transitive QA environments that you spin up for testing are all of the "QA" deploy type, etc.
