/**
 * Copyright (c) HashiCorp, Inc.
 * Copyright (c) OpenTofu
 * Copyright (c) StepSecurity
 * SPDX-License-Identifier: MPL-2.0
 */

import { jest } from '@jest/globals';

// Node.js core
import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import { join } from 'path';

// Set up mocks BEFORE dynamic imports
jest.unstable_mockModule('@actions/core', () => ({
  getInput: jest.fn(),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  addPath: jest.fn(),
  exportVariable: jest.fn()
}));

jest.unstable_mockModule('@actions/io', () => ({
  mv: jest.fn(),
  cp: jest.fn(),
  mkdirP: jest.fn()
}));

jest.unstable_mockModule('@actions/tool-cache', () => ({
  downloadTool: jest.fn(),
  extractZip: jest.fn(),
  find: jest.fn(),
  cacheDir: jest.fn()
}));

jest.unstable_mockModule('../releases.js', () => ({
  getRelease: jest.fn(),
  Release: jest.fn()
}));

// Dynamic imports pick up the mocks
const { getInput, warning } = await import('@actions/core');
const tc = await import('@actions/tool-cache');
const io = await import('@actions/io');
const { getRelease } = await import('../releases.js');
const { default: setup } = await import('../setup-tofu.js');

// Set up global test fixtures
const fallbackVersion = 'latest';
let tempDir;
let tempDirPath;
let version = '1.10.5';
let versionFile;
let versionFileName = '.opentofu-version';

describe('setup-tofu', () => {
  beforeAll(async () => {
    // Write version file to temporary directory
    tempDirPath = join(tmpdir(), 'setup-tofu-');
    tempDir = await fs.mkdtemp(tempDirPath);
    versionFile = join(tempDir, versionFileName);
    await fs.writeFile(versionFile, `${version}\n`);

    // Create a mock zip file and matching SHA256SUMS for checksum verification
    const mockZipPath = join(tempDir, 'mock.zip');
    await fs.writeFile(mockZipPath, 'mock-zip-content');
    const mockZipHash = createHash('sha256')
      .update('mock-zip-content')
      .digest('hex');
    const buildName = `tofu_${version}_linux_amd64.zip`;
    const mockSumsPath = join(tempDir, 'SHA256SUMS');
    await fs.writeFile(mockSumsPath, `${mockZipHash}  ${buildName}\n`);

    // Mock dependencies
    tc.downloadTool.mockImplementation((url) => {
      if (url.includes('SHA256SUMS')) return Promise.resolve(mockSumsPath);
      return Promise.resolve(mockZipPath);
    });
    tc.extractZip.mockResolvedValue('/mock/extract/path');
    tc.find.mockReturnValue(null); // Default to cache miss
    tc.cacheDir.mockResolvedValue('/mock/cached/path');

    io.mv.mockResolvedValue();
    io.cp.mockResolvedValue();
    io.mkdirP.mockResolvedValue();

    const mockRelease = {
      version: '1.10.5',
      getBuild: jest.fn().mockReturnValue({ url: 'mock-url', name: buildName })
    };
    getRelease.mockResolvedValue(mockRelease);

    // Mock action inputs to return default values
    getInput.mockImplementation((name) => {
      const defaults = {
        tofu_version: fallbackVersion,
        tofu_version_file: versionFile,
        cli_config_credentials_hostname: '',
        cli_config_credentials_token: '',
        tofu_wrapper: 'true',
        cache: 'false',
        github_token: ''
      };
      return defaults[name] || '';
    });

    // Mock environment variables
    process.env.GITHUB_TOKEN = 'mock-github-token';
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(async () => {
    delete process.env.GITHUB_TOKEN;
  });

  describe('tofu_version_file functionality', () => {
    it('should read version from file when tofu_version_file is provided', async () => {
      jest.spyOn(fs, 'readFile');

      await setup();

      expect(getRelease).toHaveBeenCalledWith(
        version,
        process.env.GITHUB_TOKEN
      );

      expect(fs.readFile).toHaveBeenCalled();
    });

    it('should handle empty version file gracefully', async () => {
      jest.spyOn(fs, 'readFile');

      version = ' ';
      versionFileName = '.opentofu-version-empty';
      versionFile = join(tempDir, versionFileName);
      await fs.writeFile(versionFile, `${version}\n`);

      getInput.mockImplementation((name) => {
        if (name === 'tofu_version_file') {
          return versionFile;
        }
        if (name === 'tofu_version') {
          return fallbackVersion;
        }
        return '';
      });

      await setup();

      expect(getRelease).toHaveBeenCalledWith(
        fallbackVersion,
        process.env.GITHUB_TOKEN
      );

      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining(`Version file ${versionFile} is empty`)
      );

      expect(fs.readFile).toHaveBeenCalled();
    });

    it('should handle file read errors gracefully', async () => {
      jest.spyOn(fs, 'readFile');

      versionFileName = '.opentofu-version-file-does-not-exist';
      versionFile = join(tempDir, versionFileName);

      getInput.mockImplementation((name) => {
        if (name === 'tofu_version_file') {
          return versionFile;
        }
        if (name === 'tofu_version') {
          return fallbackVersion;
        }
        return '';
      });

      await setup();

      expect(getRelease).toHaveBeenCalledWith(
        fallbackVersion,
        process.env.GITHUB_TOKEN
      );

      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining(
          `Failed to read version from file ${versionFile}`
        )
      );

      expect(fs.readFile).toHaveBeenCalled();
    });

    it('should not read file when tofu_version_file is not provided', async () => {
      jest.spyOn(fs, 'readFile');

      getInput.mockImplementation((name) => {
        if (name === 'tofu_version') {
          return fallbackVersion;
        }
        return '';
      });

      await setup();

      expect(getRelease).toHaveBeenCalledWith(
        fallbackVersion,
        process.env.GITHUB_TOKEN
      );

      // fs.readFile is called for SHA256SUMS verification, but NOT for the version file
      const readFileCalls = fs.readFile.mock.calls.map((c) => c[0]);
      expect(readFileCalls).not.toEqual(
        expect.arrayContaining([expect.stringContaining('.opentofu-version')])
      );
    });
  });

  describe('caching functionality', () => {
    it('should use cached version when cache is enabled and found', async () => {
      tc.find.mockReturnValue('/mock/cached/path');

      getInput.mockImplementation((name) => {
        const defaults = {
          tofu_version: fallbackVersion,
          tofu_version_file: '',
          cli_config_credentials_hostname: '',
          cli_config_credentials_token: '',
          tofu_wrapper: 'true',
          cache: 'true',
          github_token: ''
        };
        return defaults[name] || '';
      });

      await setup();

      expect(tc.find).toHaveBeenCalledWith('tofu', '1.10.5', expect.any(String));
      expect(tc.downloadTool).not.toHaveBeenCalled();
      expect(tc.extractZip).not.toHaveBeenCalled();
      expect(tc.cacheDir).not.toHaveBeenCalled();
    });

    it('should download and cache when cache is enabled but not found', async () => {
      tc.find.mockReturnValue(null); // Cache miss

      getInput.mockImplementation((name) => {
        const defaults = {
          tofu_version: fallbackVersion,
          tofu_version_file: '',
          cli_config_credentials_hostname: '',
          cli_config_credentials_token: '',
          tofu_wrapper: 'true',
          cache: 'true',
          github_token: ''
        };
        return defaults[name] || '';
      });

      await setup();

      expect(tc.find).toHaveBeenCalledWith('tofu', '1.10.5', expect.any(String));
      expect(tc.downloadTool).toHaveBeenCalled();
      expect(tc.extractZip).toHaveBeenCalled();
      expect(tc.cacheDir).toHaveBeenCalledWith('/mock/extract/path', 'tofu', '1.10.5', expect.any(String));
    });

    it('should not use cache when cache is disabled', async () => {
      tc.find.mockReturnValue('/mock/cached/path');

      getInput.mockImplementation((name) => {
        const defaults = {
          tofu_version: fallbackVersion,
          tofu_version_file: '',
          cli_config_credentials_hostname: '',
          cli_config_credentials_token: '',
          tofu_wrapper: 'true',
          cache: 'false',
          github_token: ''
        };
        return defaults[name] || '';
      });

      await setup();

      expect(tc.find).not.toHaveBeenCalled();
      expect(tc.downloadTool).toHaveBeenCalled();
      expect(tc.extractZip).toHaveBeenCalled();
      expect(tc.cacheDir).not.toHaveBeenCalled();
    });
  });
});
