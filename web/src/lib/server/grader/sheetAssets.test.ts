import { describe, expect, it } from 'vitest';

import {
	buildSheetWorkspaceAssetUrl,
	isAllowedSheetMarkdownAssetPath,
	isAllowedSourceAttachmentPath,
	isAllowedSourcePageImagePath,
	isAllowedWorksheetAssetPath,
	rewriteGraderWorksheetReportAssetTargets,
	rewriteSolveSheetDraftAssetTargets
} from './sheetAssets';

describe('sheet asset rewriting', () => {
	it('recognizes supported worksheet asset paths', () => {
		expect(isAllowedWorksheetAssetPath('grader/output/assets/q1-figure.png')).toBe(true);
		expect(isAllowedWorksheetAssetPath('/sheet/output/assets/q2-table.png')).toBe(true);
		expect(isAllowedWorksheetAssetPath('grader/uploads/source.pdf')).toBe(false);
		expect(isAllowedSourceAttachmentPath('grader/uploads/source.pdf')).toBe(true);
		expect(isAllowedSourcePageImagePath('grader/output/source-pages/page-0001.jpg')).toBe(true);
		expect(isAllowedSheetMarkdownAssetPath('grader/uploads/photo.jpg#spark-bbox=1,2,3,4')).toBe(
			true
		);
		expect(isAllowedSourceAttachmentPath('grader/output/assets/q1-figure.png')).toBe(false);
	});

	it('builds attachment URLs for worksheet assets', () => {
		expect(
			buildSheetWorkspaceAssetUrl({
				sheetId: 'sheet-1',
				filePath: 'grader/output/assets/q1-figure.png'
			})
		).toBe(
			'/api/spark/sheets/sheet-1/attachment?path=grader%2Foutput%2Fassets%2Fq1-figure.png&filename=q1-figure.png'
		);
		expect(
			buildSheetWorkspaceAssetUrl({
				sheetId: 'sheet-1',
				filePath: 'grader/uploads/photo.jpg#spark-bbox=100,120,800,600'
			})
		).toBe(
			'/api/spark/sheets/sheet-1/attachment?path=grader%2Fuploads%2Fphoto.jpg&filename=photo.jpg#spark-bbox=100,120,800,600'
		);
	});

	it('rewrites worksheet markdown asset targets in drafts and reports', () => {
		const draft = rewriteSolveSheetDraftAssetTargets({
			sheetId: 'sheet-1',
			draft: {
				schemaVersion: 1,
				mode: 'draft',
				sheet: {
					id: 'draft-1',
					subject: 'Biology',
					level: 'GCSE',
					title: 'Draft',
					subtitle: 'Solve the questions.',
					color: '#123456',
					accent: '#345678',
					light: '#f0f4f8',
					border: '#89abcd',
					sections: [
						{
							id: 'Q',
							label: 'Questions',
							questions: [
								{
									id: 'q1',
									type: 'group',
									displayNumber: '1',
									prompt:
										'[![Figure 1](sheet/output/assets/q1-figure.png)](sheet/output/assets/q1-figure.png)',
									questions: [
										{
											id: 'q1a',
											type: 'lines',
											displayNumber: '1(a)',
											marks: 1,
											prompt: 'Use the figure.',
											lines: 2
										}
									]
								}
							]
						}
					]
				}
			}
		});

		const report = rewriteGraderWorksheetReportAssetTargets({
			sheetId: 'sheet-1',
			report: {
				schemaVersion: 1,
				sheet: draft.sheet,
				answers: {
					q1a: 'Root tissue'
				},
				review: {
					score: {
						got: 1,
						total: 1
					},
					label: '1/1',
					message: 'Well done.',
					note: 'Good work.',
					questions: {
						q1a: {
							status: 'correct',
							score: {
								got: 1,
								total: 1
							},
							note: 'Correct.'
						}
					}
				},
				references: {
					problemMarkdown: '[question paper](grader/output/assets/q1-figure.png)'
				}
			}
		});

		const group = draft.sheet.sections[0];
		if (!group || !('id' in group) || group.questions?.[0]?.type !== 'group') {
			throw new Error('Expected grouped section in rewritten draft.');
		}

		expect(group.questions[0].prompt).toContain('/api/spark/sheets/sheet-1/attachment?path=');
		expect(group.questions[0].prompt).toBe(
			'[![Figure 1](/api/spark/sheets/sheet-1/attachment?path=sheet%2Foutput%2Fassets%2Fq1-figure.png&filename=q1-figure.png)](/api/spark/sheets/sheet-1/attachment?path=sheet%2Foutput%2Fassets%2Fq1-figure.png&filename=q1-figure.png)'
		);
		expect(report.references?.problemMarkdown).toContain(
			'/api/spark/sheets/sheet-1/attachment?path='
		);
	});

	it('rewrites localized source-photo viewport image targets while preserving one downloaded source', () => {
		const draft = rewriteSolveSheetDraftAssetTargets({
			sheetId: 'sheet-1',
			draft: {
				schemaVersion: 1,
				mode: 'draft',
				sheet: {
					id: 'draft-1',
					subject: 'Biology',
					level: 'GCSE',
					title: 'Draft',
					subtitle: 'Solve the questions.',
					color: '#123456',
					accent: '#345678',
					light: '#f0f4f8',
					border: '#89abcd',
					sections: [
						{
							id: 'Q',
							label: 'Questions',
							questions: [
								{
									id: 'q1',
									type: 'lines',
									marks: 1,
									prompt:
										'[![Figure 1](grader/uploads/photo.jpg#spark-bbox=100,120,800,600)](grader/uploads/photo.jpg)',
									lines: 2
								}
							]
						}
					]
				}
			}
		});

		const section = draft.sheet.sections[0];
		if (!section || !('questions' in section) || section.questions?.[0]?.type !== 'lines') {
			throw new Error('Expected lines question in rewritten draft.');
		}

		expect(section.questions[0].prompt).toBe(
			'[![Figure 1](/api/spark/sheets/sheet-1/attachment?path=grader%2Fuploads%2Fphoto.jpg&filename=photo.jpg#spark-bbox=100,120,800,600)](/api/spark/sheets/sheet-1/attachment?path=grader%2Fuploads%2Fphoto.jpg&filename=photo.jpg)'
		);
	});

	it('rewrites PDF crop links to full rendered source-page images', () => {
		const draft = rewriteSolveSheetDraftAssetTargets({
			sheetId: 'sheet-1',
			draft: {
				schemaVersion: 1,
				mode: 'draft',
				sheet: {
					id: 'draft-1',
					subject: 'Biology',
					level: 'GCSE',
					title: 'Draft',
					subtitle: 'Solve the questions.',
					color: '#123456',
					accent: '#345678',
					light: '#f0f4f8',
					border: '#89abcd',
					sections: [
						{
							id: 'Q',
							label: 'Questions',
							questions: [
								{
									id: 'q1',
									type: 'lines',
									marks: 1,
									prompt:
										'[![Figure 1](grader/output/assets/q1-figure.jpg)](grader/output/source-pages/page-0003.jpg)',
									lines: 2
								}
							]
						}
					]
				}
			}
		});

		const section = draft.sheet.sections[0];
		if (!section || !('questions' in section) || section.questions?.[0]?.type !== 'lines') {
			throw new Error('Expected lines question in rewritten draft.');
		}

		expect(section.questions[0].prompt).toBe(
			'[![Figure 1](/api/spark/sheets/sheet-1/attachment?path=grader%2Foutput%2Fassets%2Fq1-figure.jpg&filename=q1-figure.jpg)](/api/spark/sheets/sheet-1/attachment?path=grader%2Foutput%2Fsource-pages%2Fpage-0003.jpg&filename=page-0003.jpg)'
		);
	});
});
