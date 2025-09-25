import { fail } from '@sveltejs/kit';
import { z } from 'zod';

import type { Actions, PageServerLoad } from './$types';
import { computeSlopAutoSignals } from '$lib/slop/metrics';
import { runSlopJudge } from '$lib/server/llm/slopJudge';

const InputSchema = z.object({
        domain: z.enum(['news', 'qa', 'other']),
        context: z
                .string()
                .trim()
                .max(4000)
                .optional(),
        title: z
                .string()
                .trim()
                .max(120)
                .optional(),
        text: z
                .string()
                .trim()
                .min(1, 'Text is required')
                .max(8000)
});

type InputValues = z.infer<typeof InputSchema>;

type ActionFailure = {
        success: false;
        errors: Record<string, string[]>;
        message?: string;
        values: Partial<InputValues>;
};

type ActionSuccess = {
        success: true;
        result: Awaited<ReturnType<typeof runSlopJudge>>;
        values: InputValues;
};

export const load: PageServerLoad = async () => ({
        domains: ['qa', 'news', 'other'] as const
});

export const actions: Actions = {
        default: async ({ request }) => {
                const formData = await request.formData();
                const raw = {
                        domain: formData.get('domain'),
                        context: formData.get('context'),
                        title: formData.get('title'),
                        text: formData.get('text')
                };
                const parsed = InputSchema.safeParse(raw);
                if (!parsed.success) {
                        const errors = parsed.error.flatten().fieldErrors;
                        return fail(400, {
                                success: false,
                                errors,
                                values: {
                                        domain: typeof raw.domain === 'string' ? (raw.domain as InputValues['domain']) : undefined,
                                        context: typeof raw.context === 'string' ? raw.context : undefined,
                                        title: typeof raw.title === 'string' ? raw.title : undefined,
                                        text: typeof raw.text === 'string' ? raw.text : undefined
                                }
                        } satisfies ActionFailure);
                }

                const values = parsed.data;
                const autoSignals = computeSlopAutoSignals(values.text);

                try {
                        const result = await runSlopJudge({
                                domain: values.domain,
                                context: values.context,
                                text: values.text,
                                requestId: 'admin-sample',
                                autoSignals
                        });

                        return {
                                success: true,
                                result,
                                values
                        } satisfies ActionSuccess;
                } catch (error) {
                        const message = error instanceof Error ? error.message : 'Unable to run slop detector';
                        return fail(500, {
                                success: false,
                                message,
                                errors: {},
                                values
                        } satisfies ActionFailure);
                }
        }
};
