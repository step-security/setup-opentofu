/**
 * Copyright (c) HashiCorp, Inc.
 * Copyright (c) OpenTofu
 * Copyright (c) StepSecurity
 * SPDX-License-Identifier: MPL-2.0
 */

import { setFailed, debug, info, error as logError } from '@actions/core';
import axios from 'axios';
import * as fs from 'fs';

import setup from './lib/setup-tofu.js';
import { getErrorMessage, getErrorDetail } from './lib/error-utils.js';

async function validateSubscription () {
  let repoPrivate;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath && fs.existsSync(eventPath)) {
    const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    repoPrivate = payload?.repository?.private;
  }

  const upstream = 'opentofu/setup-opentofu';
  const action = process.env.GITHUB_ACTION_REPOSITORY;
  const docsUrl = 'https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions';
  info('');
  info('\u001b[1;36mStepSecurity Maintained Action\u001b[0m');
  info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false) info('\u001b[32m\u2713 Free for public repositories\u001b[0m');
  info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
  info('');
  if (repoPrivate === false) return;
  const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
  const body = { action: action || '' };
  if (serverUrl !== 'https://github.com') body.ghes_server = serverUrl;
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body, { timeout: 3000 }
    );
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 403) {
      logError(`\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`); // eslint-disable-line quotes
      logError(`\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`);
      process.exit(1);
    }
    info('Timeout or API not reachable. Continuing to next step.');
  }
}

(async () => {
  try {
    await validateSubscription();
    await setup();
  } catch (error) {
    const message = getErrorMessage(error);
    debug(getErrorDetail(error));
    setFailed(message);
  }
})();
