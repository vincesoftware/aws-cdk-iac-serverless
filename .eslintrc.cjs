// https://dev.to/robertcoopercode/using-eslint-and-prettier-in-a-typescript-project-53jb

module.exports = {
    env: {
        'node': true
    },
    globals: {

    },
    parser:  '@typescript-eslint/parser',  // Specifies the ESLint parser
    plugins: ['@typescript-eslint'],

    extends:  [
        'eslint:recommended',
        'plugin:@typescript-eslint/eslint-recommended',
        'plugin:@typescript-eslint/recommended'
    ],
    parserOptions:  {
        ecmaVersion:  2019,  // Allows for the parsing of modern ECMAScript features
        sourceType:  'module',  // Allows for the use of imports
    },
    rules:  {
        // Place to specify ESLint rules. Can be used to overwrite rules specified from the extended configs
        // e.g. "@typescript-eslint/explicit-function-return-type": "off",
        'indent': [
            'error',
            4,
            { 'SwitchCase': 1 }
        ],
        'semi': [
            'error',
            'always'
        ],
        'quotes': [
            'error',
            'single'
        ],
        'object-curly-spacing': [ 'error', 'always'],
        'no-multiple-empty-lines': ['error', { max: 2 }],
        'camelcase': 'off',
        '@typescript-eslint/camelcase': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-use-before-define': 'off',
        '@typescript-eslint/explicit-module-boundary-types': 1,
        '@typescript-eslint/no-unused-vars': [
            'warn',
            {
                argsIgnorePattern: "^_"
            }
        ]
    },
};
