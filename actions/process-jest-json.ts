import { context } from "@actions/github";
import type { FormattedTestResults } from "@jest/test-result/build/types";
import { resolve } from "path";

import type { Annotation } from "@obidos/actions/read-config-file";
import { readJsonFile, withGitHub } from "@obidos/actions/read-config-file";

type KeysOfType<T, TProp> = NonNullable<
  {
    [P in keyof T]: T[P] extends TProp ? P : never;
  }[keyof T]
>;

function getAnnotations(results: FormattedTestResults, cwd: string): Annotation[] {
  return results.testResults.flatMap((result) =>
    result.assertionResults
      .filter((assertion) => assertion.status === "failed")
      .map((assertion) => ({
        path: result.name.replace(cwd, ""),
        start_line: assertion.location?.line ?? 0,
        end_line: assertion.location?.line ?? 0,
        annotation_level: "failure",
        title: assertion.ancestorTitles.concat(assertion.title).join(" › "),
        message: assertion.failureMessages?.join("\n\n") ?? "",
      })),
  );
}

async function combineAnnotations(
  jestFilePromises: Promise<FormattedTestResults>[],
  root: string,
): Promise<Annotation[]> {
  return (
    await Promise.all(
      jestFilePromises.map(async (jestFilePromise) =>
        getAnnotations(await jestFilePromise, root),
      ),
    )
  ).flat();
}

function getSha(): string {
  return context.payload.pull_request?.head.sha ?? context.sha;
}

function getOutputText(results: FormattedTestResults[]) {
  const entries = results
    .flatMap((result) => result.testResults)
    .map((r) => r.message)
    .filter(Boolean);
  return "```\n" + entries.join("\n").trimRight() + "\n```";
}

const main = ([, , ...paths]: string[]) =>
  withGitHub(async () => {
    const root = resolve(__dirname, "..");

    const jestFilePromises = paths.map((path) =>
      readJsonFile<FormattedTestResults>(resolve(root, path)),
    );

    const annotationsPromise = combineAnnotations(jestFilePromises, root);

    const jestFiles = await Promise.all(jestFilePromises);

    const success = jestFiles.every((file) => file.success);
    type SummaryKey = KeysOfType<FormattedTestResults, number>;
    const summaryKeys: SummaryKey[] = [
      "numPassedTests",
      "numPassedTestSuites",
      "numFailedTests",
      "numFailedTestSuites",
      "numTotalTests",
      "numTotalTestSuites",
    ];
    const summary = Object.fromEntries(
      summaryKeys.map((summaryKey) => [
        summaryKey,
        jestFiles.map((jestFile) => jestFile[summaryKey]).reduce((a, b) => a + b, 0),
      ]),
    ) as Record<SummaryKey, number>;

    const summaryText = success
      ? `${summary.numPassedTests} tests passing in ${summary.numPassedTestSuites} suite${
          summary.numPassedTestSuites > 1 ? "s" : ""
        }.`
      : `Failed tests: ${summary.numFailedTests}/${summary.numTotalTests}. Failed suites: ${summary.numFailedTestSuites}/${summary.numTotalTestSuites}.`;

    return {
      ...context.repo,
      head_sha: getSha(),
      name: "Test results",
      status: "completed",
      conclusion: success ? "success" : "failure",
      output: {
        title: success ? "Jest tests passed" : "Jest tests failed",
        text: success ? "" : getOutputText(jestFiles),
        summary: summaryText,
        annotations: await annotationsPromise,
      },
    };
  });

if (require.main === module) {
  main(process.argv).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
