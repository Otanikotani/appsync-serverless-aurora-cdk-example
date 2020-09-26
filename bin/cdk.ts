#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import {AppServOraStack} from "../lib/appservora-stack";
import {Environment} from "@aws-cdk/core";

const env: Environment = {
};

const app = new cdk.App();

new AppServOraStack(app, 'AppServOraStack', { env });
