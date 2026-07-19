import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
export default [js.configs.recommended, ...tseslint.configs.recommended, prettier, { languageOptions:{globals:{...globals.browser,...globals.node}}, ignores:['dist','node_modules'] }];
