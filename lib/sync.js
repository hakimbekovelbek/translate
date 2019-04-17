
const config = require("../config");
const debug = require('debug')('lib:sync');
const Octokit = require('@octokit/rest');
const updateRepo = require('../lib/updateRepo');
const run = require('../lib/run');
const path = require('path');

const octokitBot = new Octokit({
  auth: `token ${config.secret.github.tokenBot}`
});

module.exports = async (langInfo) => {

  await updateRepo(langInfo.code);

  let translatedPath = path.join(config.repoRoot, `${langInfo.code}.${config.repoSuffix}`);

  await run(`git fetch upstream master`, { cwd: translatedPath });

  const hash = await run(`git rev-parse upstream/master`, { cwd: translatedPath });

  const shortHash = hash.slice(0, 8);

  const syncBranch = `sync-${shortHash}`;

  await run(`git checkout -B ${syncBranch} master`, {cwd: translatedPath});

  // Pull from {source}/master

  let output;
  try {
    output = await run(`git pull upstream master`, {cwd: translatedPath});
  } catch(err) {
    if (err.code === 1 && err.stdout.trim().endsWith('Automatic merge failed; fix conflicts and then commit the result.')) {
      // merge failed, let's handle the output
      output = err.stdout;
    } else {
      throw err;
    }
  }
  if (output.includes('Already up to date.')) {
    debug(`We are already up to date with upstream`);
    return;
  }

  let conflictFiles = await run(`git diff --name-only --diff-filter=U`, {cwd: translatedPath });
  conflictFiles = conflictFiles.split('\n');

  await run(`git commit -am "merging all conflicts"`, {cwd: translatedPath});

  // If no conflicts, merge directly into master
  if (conflictFiles.length === 0) {
    debug('No conflicts found. Committing directly to master.');
    await run(`git checkout master`, {cwd: translatedPath});
    await run(`git merge ${syncBranch}`, {cwd: translatedPath});
    await run(`git push origin master`, {cwd: translatedPath});
    process.exit(0);
  }

  debug('conflict files: ', conflictFiles.join('\n'));

  // Create a new pull request, listing all conflicting files
  await run(`git push --force --set-upstream origin ${syncBranch}`, {cwd: translatedPath});

  const title = `Sync with upstream @ ${shortHash}`;

  const conflictsText = `
The following files have conflicts and may need new translations:
${conflictFiles
  .map(
    file =>
      ` * [ ] [${file}](/${config.org}/${config.langMain}.${config.repoSuffix}/commits/master/${file})`,
  )
  .join('\n')}
Please fix the conflicts by pushing new commits to this pull request, either by editing the files directly on GitHub or by checking out this branch.
`;

  const body = `
This PR was automatically generated.
Merge changes from [en.javascript.info](https://github.com/${config.org}/${config.langMain}.${config.repoSuffix}/commits/master) at ${shortHash}
${conflictFiles.length > 0 ? conflictsText : 'No conflicts were found.'}

You can close this PR and merge the changes manually:
1. \`git add remote upstream https://github.com/javascript-tutorial/en.javascript.info\`
2. \`git checkout master\`
3. \`git pull upstream master\`
4. Deal with the conflicts. If there are many changes in a file, e.g. \`README.md\`, then you could:  
    - Checkout your version, \`git checkout --ours README.md\`
    - See what changed in the original file: \`git diff master...upstream/master README.md\` (three dots)
    - Update your version
    - \`git commit -m synced README.md\`
5. When resolved the conflicts, \`git push origin master\`
`;

  try {
    const {
      data: {number},
    } = await octokitBot.pulls.create({
      owner: config.org,
      repo:  `${langInfo.code}.${config.repoSuffix}`,
      title,
      body,
      head:  syncBranch,
      base:  'master',
    });

    /*
    await octokitBot.pulls.createReviewRequest({
      owner: config.org,
      repo: `${langInfo.code}.${config.repoSuffix}`,
      number,
      reviewers: getRandomSubset(maintainers, 3),
    });
  */
  } catch(err) {
    if (err.name === 'HttpError') {
      console.error(err.errors);
    }
    throw err;
  }

};


// Helper functions

function getRandomInt(min, max) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomSubset(array, n) {
  if (array.length <= n) {
    return array;
  }
  const copy = [...array];
  let result = [];
  while (result.length < n) {
    const i = getRandomInt(0, copy.length);
    result = result.concat(copy.splice(i, 1));
  }
  return result;
}