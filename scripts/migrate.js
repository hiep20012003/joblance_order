require('ts-node/register');
require('tsconfig-paths/register');
require('../src/db/umzug').migrator.runAsCLI();
