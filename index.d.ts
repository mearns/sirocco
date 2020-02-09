import * as justRunIt from "just-run-it";

declare module "sirocco" {
    /**
     * A javascript file used as a sirocco config should export
     * a value of this type: either the config object directly,
     * or a function that returns (synchronously or asynchronously)
     * the config object.
     */
    export type ConfigExport =
        | Config
        | (() => ConfigExport | Promise<ConfigExport>);

    /**
     * This is the main sirocco config object. Your config file should fit this.
     */
    export interface Config {
        options?: ConfigOptions;
        defaultStacks?: string[];
        global?: ConfigLayer;
        deployTypes?: {
            [deployType: string]: DeployType;
        };
        envs?: {
            [envName: string]: ConfigLayer;
        };
    }

    export interface ConfigOptions {
        branchDeployType?: string[];
        validate?: boolean;
        dump?: boolean;
    }

    export interface ConfigLayer {
        params?: Params;
        deployBucket?: Resolvable;
        deployBucketPrefix?: Resolvable;
        role?: Resolvable;
        envNameParamName?: Resolvable;
        cfnStackName?: Resolvable;
        inputTemplate?: Resolvable;
        outputTemplate?: Resolvable;
        capabilities?: string[];
        authenticationCommand?:
            | string
            | string[]
            | ((
                  stack: string,
                  env: string,
                  options: {
                      role: string;
                      dryRun: boolean;
                      execute: justRunIt.JustRunIt;
                  }
              ) => Promise<any>);
        stackTags?:
            | ((
                  stack: string,
                  env: string,
                  resolvedParams: { [paramName: string]: string }
              ) => { [tagName: string]: string })
            | { [resolvableTagName: string]: Resolvable };
    }

    export interface DeployType extends ConfigLayer {
        validEnvs: EnvNameValidator;
    }

    export type Resolvable =
        | string
        | ((stack: string, env: string, params: Params) => string);

    export interface Params {
        [paramName: string]: Resolvable;
    }

    export type EnvNameValidator =
        | ((envName: string) => boolean)
        | string
        | RegExp
        | EnvNameValidator[];
}
