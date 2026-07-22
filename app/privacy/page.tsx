import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_CONTACT_URL,
  PRIVACY_LAST_UPDATED,
  PRIVACY_LAST_UPDATED_ISO,
} from "@/lib/legal";
import { createPageMetadata } from "@/lib/site-metadata";

export const metadata = createPageMetadata({
  description:
    "How Shadscan processes repository scans, request data, local preferences, and communications.",
  path: "/privacy",
  title: "Privacy Policy",
});

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
      <article className="typeset max-w-3xl pb-12">
        <header>
          <p className="not-typeset font-mono text-muted-foreground text-sm">
            Legal
          </p>
          <h1>Privacy Policy</h1>
          <p>
            <strong>Last updated:</strong>{" "}
            <time dateTime={PRIVACY_LAST_UPDATED_ISO}>
              {PRIVACY_LAST_UPDATED}
            </time>
          </p>
          <p>
            Shadscan is an OrcDev project. This policy explains how we process
            information when you visit the Shadscan website, use its hosted
            scanner or API, or contact us.
          </p>
        </header>

        <section>
          <h2>At a glance</h2>
          <ul>
            <li>
              The Shadscan CLI runs locally. It does not send your source code
              or scan results to us unless you explicitly use a hosted Shadscan
              endpoint.
            </li>
            <li>
              The public web scanner accepts public GitHub repositories only.
            </li>
            <li>
              Source material used for a hosted scan is extracted into temporary
              storage and deleted after the scan completes or fails.
            </li>
            <li>
              We may cache a successful report for the same public repository
              commit to avoid repeating identical work. Source files and
              archives are not cached.
            </li>
            <li>
              Shadscan uses deterministic rules rather than AI, and we do not
              use submitted source or reports to train AI models.
            </li>
            <li>
              We use Vercel Web Analytics for aggregate page-view statistics. We
              do not add advertising trackers or sell personal information.
            </li>
          </ul>
        </section>

        <section>
          <h2>Information we process</h2>

          <h3>Website and request information</h3>
          <p>
            Our hosting provider may process standard request information such
            as your IP address, browser and device information, requested URL,
            timestamps, response status, and diagnostic data. We use this
            information to deliver and secure the service and investigate
            failures or abuse.
          </p>
          <p>
            We enable Vercel Web Analytics, which records page views and may
            process the timestamp, page path, referrer, filtered query
            parameters, coarse location, browser, operating system, device type,
            and analytics script version. Vercel derives a short-lived visitor
            hash from the incoming request for aggregate statistics and discards
            the visitor session after 24 hours. We do not send repository input
            or scan reports as custom analytics events.
          </p>

          <h3>Public repository scans</h3>
          <p>
            When you submit a repository through the web scanner, we process the
            public GitHub owner and repository name. Shadscan asks GitHub for
            repository metadata and a source archive, scans a temporary copy,
            and returns the report to your browser.
          </p>
          <p>
            Runtime logs for web scans may include the public repository name, a
            random request identifier, scan outcome, duration, resolved
            revision, score, actionable count, and Shadscan engine and ruleset
            versions. Failed scans are logged without the submitted repository
            name.
          </p>
          <p>
            When report caching is enabled, Neon may store a successful report,
            the immutable commit, selected project path, scanner versions, and a
            digest of the repository identifier. The cache does not contain
            source files or archives. Failed and incomplete scans are not
            cached.
          </p>

          <h3>Hosted API scans</h3>
          <p>
            Authenticated API users may request a public GitHub scan or submit a
            compressed project snapshot. A snapshot can contain source code and
            other files selected by the user. Do not submit secrets,
            credentials, private keys, unnecessary personal information, or
            files you are not authorized to process.
          </p>
          <p>
            API keys are compared using cryptographic hashes. Rate limits use
            the API key identifier rather than storing the presented secret as
            the rate-limit key.
          </p>

          <h3>Rate-limit information</h3>
          <p>
            The web scanner reads the network address supplied by our trusted
            hosting layer and immediately transforms it into a keyed HMAC value.
            The raw address is not stored in the application&apos;s rate-limit
            table. We separately transform the normalized public repository
            identifier into a SHA-256 digest to prevent repeated scans of the
            same repository. Neon Postgres stores those digests with counters
            and window timestamps configured around ten-minute and
            twenty-four-hour limits.
          </p>

          <h3>Local preferences</h3>
          <p>
            Shadscan stores your light, dark, or system theme choice under the
            local-storage key <code>theme</code>. This preference stays in your
            browser and can be removed through your browser settings.
          </p>

          <h3>Communications</h3>
          <p>
            If you email us, we process your email address and the contents of
            your message so we can respond and maintain appropriate business
            records.
          </p>
        </section>

        <section>
          <h2>How we use information</h2>
          <p>We process information to:</p>
          <ul>
            <li>provide repository scans and return deterministic reports;</li>
            <li>authenticate API requests and enforce usage limits;</li>
            <li>protect Shadscan, its users, and third parties from abuse;</li>
            <li>diagnose failures and maintain service reliability;</li>
            <li>respond to support, legal, and business messages; and</li>
            <li>comply with law and enforce our terms.</li>
          </ul>
          <p>
            Where applicable law requires a legal basis, we rely on performance
            of a contract or steps you request before a contract, our legitimate
            interests in operating and securing Shadscan, compliance with legal
            obligations, and consent where we specifically request it.
          </p>
        </section>

        <section>
          <h2>Service providers and disclosures</h2>
          <p>We use a limited set of providers to operate Shadscan:</p>
          <ul>
            <li>
              <a href="https://vercel.com/legal/privacy-notice">Vercel</a> for
              website hosting, delivery, runtime infrastructure, logs, and
              aggregate Web Analytics;
            </li>
            <li>
              <a href="https://neon.tech/privacy-policy">Neon</a> for
              distributed rate-limit records;
            </li>
            <li>
              <a href="https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement">
                GitHub
              </a>{" "}
              as the source of public repository metadata and archives.
            </li>
          </ul>
          <p>
            We may also disclose information when required by law, to protect
            rights and safety, to professional advisers under confidentiality,
            or as part of a business transfer. We do not sell personal
            information or share it for cross-context behavioral advertising.
          </p>
        </section>

        <section>
          <h2>Retention</h2>
          <ul>
            <li>
              Temporary repository archives and snapshots are deleted after the
              scan completes or fails.
            </li>
            <li>
              Application rate-limit records contain hashed identifiers, are
              marked to expire after two configured windows, and are pruned in
              bounded batches, subject to provider backup and operational
              practices.
            </li>
            <li>
              Successful cached reports expire after the configured cache
              period, which is no more than 30 days, subject to provider backup
              and operational practices. Source files and archives are not
              included in those records.
            </li>
            <li>
              Runtime logs are retained according to our hosting configuration
              for as long as reasonably necessary for security, diagnosis, and
              reliable operation.
            </li>
            <li>
              Vercel discards the Web Analytics visitor session after 24 hours;
              aggregate page-view statistics are retained according to our
              hosting plan and configuration.
            </li>
            <li>
              Communications are retained while needed to answer your request
              and maintain appropriate business records.
            </li>
          </ul>
        </section>

        <section>
          <h2>Cookies and similar storage</h2>
          <p>
            Shadscan does not set advertising cookies. Vercel Web Analytics does
            not use third-party cookies; it uses a request-derived visitor hash
            for aggregate page views. The theme preference described above uses
            local storage. Providers and websites you visit through external
            links operate under their own cookie and privacy policies.
          </p>
        </section>

        <section>
          <h2>Your choices and rights</h2>
          <p>
            Depending on where you live, you may have rights to access, correct,
            delete, restrict, or receive a copy of your personal information,
            and to object to certain processing. You may also withdraw consent
            where processing relies on consent and lodge a complaint with your
            local data-protection authority.
          </p>
          <p>
            We do not use personal information for decisions that produce legal
            or similarly significant effects. A Shadscan score evaluates
            repository source patterns, not a person.
          </p>
          <p>
            Some identifiers are deliberately pseudonymized or short-lived,
            which may limit our ability to connect them to you. We may ask for
            enough information to verify and locate a record before responding
            to a request.
          </p>
        </section>

        <section>
          <h2>International processing and security</h2>
          <p>
            Our providers may process information in countries other than your
            own. Where required, transfers are handled using recognized legal
            safeguards. We use reasonable technical and organizational measures
            designed to protect information, but no online service can guarantee
            absolute security.
          </p>
        </section>

        <section>
          <h2>Children</h2>
          <p>
            Shadscan is a developer tool and is not directed to children under
            16. We do not knowingly collect personal information from children
            through the service.
          </p>
        </section>

        <section>
          <h2>Changes to this policy</h2>
          <p>
            We may update this policy as Shadscan changes. We will post the
            current version here and change the date above. Material changes may
            also be announced on this website.
          </p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>
            For privacy questions or requests, email{" "}
            <a href={LEGAL_CONTACT_URL}>{LEGAL_CONTACT_EMAIL}</a>. Do not send
            repository secrets or source code with your request.
          </p>
        </section>
      </article>
    </main>
  );
}
