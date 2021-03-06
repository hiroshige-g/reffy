#!/usr/bin/env node
/**
 * Reffy's main command line interface that you can use to crawl and study spec
 * references.
 *
 * Reffy can be called directly through:
 *
 * `node reffy.js [command]`
 *
 * Run `node reffy.js -h` for help
 *
 * @module crawler
 */

const program = require('commander');
const version = require('./package.json').version;
const fs = require('fs');
const path = require('path');
const crawlFile = require('./src/cli/crawl-specs.js').crawlFile;
const studyCrawl = require('./src/cli/study-crawl.js').studyCrawl;
const generateReport = require('./src/cli/generate-report.js').generateReport;
const pandoc = require('node-pandoc');


// List of possible perspectives and associated parameters
const perspectives = {
  'w3c': {
    description: 'take a W3C-centric perspective, preferring W3C specifications to WHATWG specifications when both exist, and crawling latest Editor\'s Drafts of specifications',
    specs: 'specs-w3c.json',
    refCrawl: 'https://tidoust.github.io/reffy-reports/w3c/crawl.json'
  },
  'w3c-tr': {
    description: 'take a W3C-centric perspective, preferring W3C specifications to WHATWG specifications when both exist, but crawling the latest published versions of specifications in /TR/ space instead of the latest Editor\'s Drafts',
    specs: 'specs-w3c.json',
    publishedVersion: true,
    refCrawl: 'https://tidoust.github.io/reffy-reports/w3c-tr/crawl.json'
  },
  'whatwg': {
    description: 'take a WHATWG-centric perspective, preferring WHATWG specifications to W3C specifications when both exist.',
    specs: 'specs-whatwg.json',
    refCrawl: 'https://tidoust.github.io/reffy-reports/whatwg/crawl.json'
  }
};

// List of possible actions for each perspective
const possibleActions = {
  'all': 'crawl specs, study report and generate markdown, HTML and diff reports. Default action',
  'crawl': 'crawl specs and generate a machine-readable report with facts about each spec',
  'study': 'parse the machine-readable report generated by the crawler, and create a study report of potential anomalies found in the report',
  'markdown': 'produce a human-readable report in Markdown format out of the report returned by the study action',
  'html': 'produce an HTML report out of the Markdown report generated by the markdown action',
  'diff': 'compare the crawl results with the latest published crawl results and generate diff report',
  'diffnew': 'compare the crawl results with the latest published crawl results and generate diff report that only contains new anomalies'
};

let command = null; 
program
  .version(version)
  .command('run <perspective> [action]')
  .description('run a new crawl and study from the given perspective')
  .action((perspective, action) => {
    command = 'run';
    if (!(perspective in perspectives)) {
      return program.help();
    }
    if (action && !(action in possibleActions)) {
      return program.help();
    }

    let specsfile = perspectives[perspective].specs;
    let publishedVersion = perspectives[perspective].publishedVersion;
    let refCrawl = perspectives[perspective].refCrawl;
    let reportFolder = perspectives[perspective].reportFolder ||
      'reports/' + perspective;
    let crawlReport = path.join(reportFolder, 'crawl.json');
    let studyReport = path.join(reportFolder, 'study.json');

    let promise = Promise.resolve();
    let actions = (!action || (action === 'all')) ?
      ['crawl', 'study', 'markdown', 'html', 'diff', 'diffnew'] :
      [action];

    actions.forEach(action => {
      switch (action) {
      case 'crawl':
        promise = promise
          .then(_ => crawlFile(
            path.resolve(__dirname, 'src', 'specs', specsfile),
            reportFolder,
            { publishedVersion }));
        break;

      case 'study':
        promise = promise
          .then(_ => studyCrawl(crawlReport))
          .then(results => {
            fs.writeFileSync(path.join(reportFolder, 'study.json'),
              JSON.stringify(results, null, 2));
          });
        break;

      case 'markdown':
        promise = promise
          .then(_ => generateReport(crawlReport, { perSpec: true }))
          .then(report => fs.writeFileSync(path.join(reportFolder, 'index.md'), report))
          .then(_ => generateReport(crawlReport, { perSpec: false }))
          .then(report => fs.writeFileSync(path.join(reportFolder, 'perissue.md'), report));
        break;

      case 'html':
        promise = promise
          .then(_ => new Promise((resolve, reject) => {
            let args = [
              '-f', 'markdown', '-t', 'html5', '--section-divs', '-s',
              '--template', path.join(__dirname, 'src', 'templates', 'report-template.html'),
              '-o', path.join(reportFolder, 'index.html')
            ];
            pandoc(path.join(reportFolder, 'index.md'), args,
              (err => {
                if (err) {
                  return reject(err);
                }
                args = [
                  '-f', 'markdown', '-t', 'html5', '--section-divs', '-s',
                  '--template', path.join(__dirname, 'src', 'templates', 'report-perissue-template.html'),
                  '-o', path.join(reportFolder, 'perissue.html')];
                pandoc(path.join(reportFolder, 'perissue.md'), args,
                  (err => {
                    if (err) {
                      return reject(err);
                    }
                    return resolve();
                  }));
              }));
            }));
        break;

      case 'diff':
        promise = promise
          .then(_ => generateReport(crawlReport, {
            diffReport: true,
            refStudyFile: refCrawl
          }))
          .then(report => fs.writeFileSync(path.join(reportFolder, 'diff.md'), report));
        break;

      case 'diffnew':
        promise = promise
          .then(_ => generateReport(crawlReport, {
            diffReport: true,
            refStudyFile: refCrawl,
            onlyNew: true
          }))
          .then(report => fs.writeFileSync(path.join(reportFolder, 'diffnew.md'), report));
        break;
      }
    });

    return promise.then(_ => console.log('-- THE END -- '))
      .catch(err => {
        console.error('-- ERROR CAUGHT --');
        console.error(err);
        process.exit(1);
      });
  });

program.on('--help', function(){
  console.log('');
  console.log('  Possible perspectives:');
  console.log('');
  Object.keys(perspectives).forEach(perspective => {
    console.log('    ' + perspective + ': ' + perspectives[perspective].description);
  });
  console.log('');

  console.log('  Possible actions:');
  console.log('');
  Object.keys(possibleActions).forEach(action => {
    console.log('    ' + action + ': ' + possibleActions[action]);
  });
  console.log('');
});

program.parse(process.argv);
if (!command) {
  return program.help();
}