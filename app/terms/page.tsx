import type { Metadata } from "next";
import Link from "next/link";
import {
  LEGAL_CONTACT_URL,
  LEGAL_LAST_UPDATED,
  LEGAL_LAST_UPDATED_ISO,
} from "@/lib/legal";

export const metadata: Metadata = {
  alternates: { canonical: "/terms" },
  description:
    "Terms governing use of the Shadscan website, CLI, hosted scanner, and API.",
  openGraph: {
    description:
      "Terms governing use of the Shadscan website, CLI, hosted scanner, and API.",
    title: "Terms of Service",
    url: "/terms",
  },
  title: "Terms of Service",
};

export default function TermsPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <article className="typeset max-w-3xl pb-12">
        <header>
          <p className="not-typeset font-mono text-muted-foreground text-sm">
            Legal
          </p>
          <h1>Terms of Service</h1>
          <p>
            <strong>Last updated:</strong>{" "}
            <time dateTime={LEGAL_LAST_UPDATED_ISO}>{LEGAL_LAST_UPDATED}</time>
          </p>
          <p>
            These terms govern your use of the Shadscan website, hosted scanner,
            hosted API, and related services. Shadscan is an OrcDev project. By
            using a hosted Shadscan service, you agree to these terms.
          </p>
        </header>

        <section>
          <h2>The service</h2>
          <p>
            Shadscan inspects React and shadcn application source for detectable
            UI fundamentals and returns deterministic findings, scores,
            evidence, and suggested actions. The public web scanner supports
            public GitHub repositories. The authenticated API may also accept a
            source snapshot.
          </p>
          <p>
            The Shadscan CLI is open-source software distributed under its own
            MIT license. These terms do not replace or restrict rights granted
            by that license. These terms apply when you access our website or
            hosted services.
          </p>
        </section>

        <section>
          <h2>Who may use Shadscan</h2>
          <p>
            You must be legally able to enter into these terms. If you use
            Shadscan for an organization, you represent that you have authority
            to bind that organization, and &quot;you&quot; includes that
            organization.
          </p>
        </section>

        <section>
          <h2>Your responsibilities</h2>
          <p>You agree that you will:</p>
          <ul>
            <li>
              submit only repositories, snapshots, and files you are authorized
              to access and process;
            </li>
            <li>
              remove secrets, credentials, private keys, and unnecessary
              personal or sensitive information before submitting a snapshot;
            </li>
            <li>
              comply with applicable law, third-party rights, and repository
              licenses;
            </li>
            <li>
              keep hosted API credentials confidential and notify us if they may
              have been compromised; and
            </li>
            <li>
              independently review findings before making product,
              accessibility, security, compliance, or legal decisions.
            </li>
          </ul>
        </section>

        <section>
          <h2>Acceptable use</h2>
          <p>You may not:</p>
          <ul>
            <li>
              interfere with, overload, probe, or disrupt Shadscan or its
              providers;
            </li>
            <li>
              evade rate limits, authentication, access controls, or safety
              limits;
            </li>
            <li>
              submit malicious archives, malware, unlawful material, or content
              designed to exploit the service;
            </li>
            <li>
              use Shadscan to violate privacy, intellectual-property, or other
              rights; or
            </li>
            <li>
              resell or provide the hosted service as your own without written
              permission.
            </li>
          </ul>
          <p>
            We may limit, suspend, or block access when reasonably necessary to
            enforce these terms, protect the service, comply with law, or
            prevent harm.
          </p>
        </section>

        <section>
          <h2>Your content</h2>
          <p>
            You retain whatever rights you have in content you submit. You grant
            us a limited, non-exclusive right to host, copy, extract, and
            process that content only as needed to provide, secure, and
            troubleshoot the requested scan. This right ends when the temporary
            scan material is deleted, except for limited operational records
            described in our <Link href="/privacy">Privacy Policy</Link>.
          </p>
          <p>
            Submitting a public GitHub repository does not give Shadscan
            ownership of that repository or change its license.
          </p>
        </section>

        <section>
          <h2>Scan results are guidance</h2>
          <p>
            Shadscan uses static rules and heuristics. Results may contain false
            positives, false negatives, incomplete evidence, or suggestions that
            do not fit your product. A score is not a certification, guarantee,
            or substitute for professional accessibility testing, security
            review, legal advice, or human product judgment.
          </p>
          <p>
            You are responsible for reviewing and testing any change made from a
            Shadscan report or agent handoff.
          </p>
        </section>

        <section>
          <h2>API credentials and limits</h2>
          <p>
            Hosted API keys remain our property and may be revoked or rotated.
            You are responsible for activity performed with your credentials.
            Usage is subject to documented and technical limits, which may
            change to protect reliability and fair access.
          </p>
        </section>

        <section>
          <h2>Third-party services</h2>
          <p>
            Shadscan relies on services such as GitHub, Vercel, Upstash, and
            npm. Your use of those services may be subject to their own terms
            and policies. We are not responsible for third-party services or
            content outside our control.
          </p>
        </section>

        <section>
          <h2>Our intellectual property</h2>
          <p>
            Except for open-source code and third-party materials governed by
            their own licenses, Shadscan&apos;s website content, branding, and
            service are owned by us or our licensors. No right to use Shadscan
            names or marks is granted except as permitted by law or with written
            permission.
          </p>
        </section>

        <section>
          <h2>Feedback</h2>
          <p>
            If you voluntarily provide ideas or feedback, you allow us to use
            them without restriction or an obligation to compensate you. This
            does not transfer ownership of your repository or source code.
          </p>
        </section>

        <section>
          <h2>Availability and changes</h2>
          <p>
            We may change, suspend, or discontinue features, rules, scores,
            limits, or hosted services. We do not promise uninterrupted
            availability or that every historical report can be reproduced after
            rules and dependencies change.
          </p>
        </section>

        <section>
          <h2>Disclaimers</h2>
          <p>
            To the maximum extent permitted by law, Shadscan and its hosted
            services are provided &quot;as is&quot; and &quot;as
            available.&quot; We disclaim implied warranties of merchantability,
            fitness for a particular purpose, non-infringement, and accuracy.
            Nothing in these terms excludes warranties or rights that cannot
            lawfully be excluded.
          </p>
        </section>

        <section>
          <h2>Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, we will not be liable for
            indirect, incidental, special, consequential, exemplary, or punitive
            damages, or for loss of profits, revenue, data, goodwill, or
            business opportunity arising from Shadscan.
          </p>
          <p>
            Our aggregate liability is limited to the greatest extent permitted
            by applicable law. These limits do not apply where liability cannot
            lawfully be limited.
          </p>
        </section>

        <section>
          <h2>Indemnity for business use</h2>
          <p>
            If you use Shadscan on behalf of a business, you will defend and
            indemnify us against third-party claims arising from content you
            submit, your violation of these terms, or your unlawful use of the
            service, to the extent permitted by law.
          </p>
        </section>

        <section>
          <h2>Termination</h2>
          <p>
            You may stop using Shadscan at any time. We may suspend or terminate
            hosted access for a material or repeated breach, legal requirement,
            security risk, or threat to other users. Provisions that by their
            nature should survive termination will continue, including
            ownership, disclaimers, liability limits, and dispute terms.
          </p>
        </section>

        <section>
          <h2>Disputes and consumer rights</h2>
          <p>
            Before filing a claim, contact us and give us a reasonable
            opportunity to resolve the issue informally. Any dispute will be
            handled by courts with lawful jurisdiction over the operator and the
            dispute. Mandatory consumer-protection rights and any forum
            available to you under applicable law are not limited by these
            terms.
          </p>
        </section>

        <section>
          <h2>Changes to these terms</h2>
          <p>
            We may update these terms as the service changes. The current
            version and date will appear on this page. Continued use after an
            update takes effect means you accept the revised terms, except where
            law requires a different form of notice or consent.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            Questions about these terms can be submitted through the{" "}
            <a href={LEGAL_CONTACT_URL}>project issue tracker</a>.
          </p>
        </section>
      </article>
    </main>
  );
}
