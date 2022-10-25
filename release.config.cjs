const createConfiguration = (publishCmd) => {
  /**
   * @type {import('semantic-release').Options}
   */
  const configuration = {
    extends: 'semantic-release-monorepo',
    branches: ['main'],
    plugins: [
      '@semantic-release/commit-analyzer',
      '@semantic-release/release-notes-generator',
      '@semantic-release/changelog',
      [
        '@semantic-release/exec',
        {
          verifyConditionsCmd: 'yarn npm whoami --publish',
          prepareCmd: [
            'yarn version ${nextRelease.version}',
            "echo 'version=${nextRelease.version}' >> $GITHUB_OUTPUT",
          ].join(' && '),
          publishCmd,
        },
      ],
      [
        '@semantic-release/github',
        {
          assets: [],
        },
      ],
      [
        '@semantic-release/exec',
        {
          prepareCmd: [
            'yarn',
            'git add ../../packages/*/yarn.lock',
            'git add ../../packages/*/package.json',
            'git add ../../.yarn/versions',
            'git commit -m "chore(release): ${nextRelease.version} [skip ci]" -m "${nextRelease.notes}"',
            'git push',
          ].join(' && '),
        },
      ],
    ],
  }

  return configuration
}

module.exports = createConfiguration
