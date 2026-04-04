export default {
	plugins: [
		'@semantic-release/commit-analyzer',
		'@semantic-release/release-notes-generator',
		'@semantic-release/npm',
		[
			'@semantic-release/git',
			{
				assets: ['package.json'],
				message: 'chore(release): ${nextRelease.gitTag} [skip ci]',
			},
		],
		[
			'@semantic-release/github',
			{
				successComment: false,
				failTitle: false,
			},
		],
	],
}
