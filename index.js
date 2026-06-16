/**
 * Copyright (c) HashiCorp, Inc.
 * Copyright (c) OpenTofu
 * Copyright (c) StepSecurity
 * SPDX-License-Identifier: MPL-2.0
 */

import { setFailed, debug } from '@actions/core';

import setup from './lib/setup-tofu.js';
import { getErrorMessage, getErrorDetail } from './lib/error-utils.js';
import { validateSubscription } from './lib/stepsecurity-subscription.js';

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
