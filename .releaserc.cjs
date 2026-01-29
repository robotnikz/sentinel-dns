module.exports = {
	branches: ['main'],
	tagFormat: 'v${version}',
	plugins: [
		['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
		[
			'@semantic-release/release-notes-generator',
			{
				preset: 'conventionalcommits',
				writerOpts: {
					transform: {
						committerDate: (date) => {
							if (!date) return undefined

							const parsed = new Date(date)
							if (Number.isNaN(parsed.getTime())) return undefined

							return parsed.toISOString().slice(0, 10)
						}
					}
				}
			}
		],
		'@semantic-release/github'
	]
}
