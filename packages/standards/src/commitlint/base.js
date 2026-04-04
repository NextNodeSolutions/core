const ERROR = 2
const WARNING = 1
const MAX_LINE_LENGTH = 100

export default {
	extends: ['@commitlint/config-conventional'],
	rules: {
		'type-enum': [
			ERROR,
			'always',
			[
				'feat',
				'fix',
				'docs',
				'style',
				'refactor',
				'perf',
				'test',
				'build',
				'ci',
				'chore',
				'revert',
			],
		],
		'type-case': [ERROR, 'always', 'lower-case'],
		'type-empty': [ERROR, 'never'],
		'scope-case': [ERROR, 'always', 'lower-case'],
		'subject-case': [
			ERROR,
			'never',
			['sentence-case', 'start-case', 'pascal-case', 'upper-case'],
		],
		'subject-empty': [ERROR, 'never'],
		'subject-full-stop': [ERROR, 'never', '.'],
		'header-max-length': [ERROR, 'always', MAX_LINE_LENGTH],
		'body-leading-blank': [WARNING, 'always'],
		'body-max-line-length': [ERROR, 'always', MAX_LINE_LENGTH],
		'footer-leading-blank': [WARNING, 'always'],
		'footer-max-line-length': [ERROR, 'always', MAX_LINE_LENGTH],
	},
}
