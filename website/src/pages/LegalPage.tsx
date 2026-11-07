import { useEffect, useRef } from "react";
import { ArrowLeft } from "lucide-react";
import { SiteLink } from "../components/SiteLink.js";

const operatorName = "AJR Creative LLC";
const contactEmail = "aj@ajr.co";

function PrivacyPolicy({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <>
      <p>
        {operatorName} operates the hosted tinytldr website at www.tinytldr.com and its associated
        hosted rendering API and MCP service. This policy explains how we handle information when
        you use those services. It does not govern independently self-hosted installations or the
        separate services of your AI provider.
      </p>
      <section>
        <h2>1. Information we process</h2>
        <ul>
          <li>
            <strong>Account information.</strong> Firebase Authentication processes your email
            address, account identifier, sign-in method, verification status and any profile name
            you provide. Google sign-in also provides account information through Google. Password
            authentication is handled by Firebase; our design database does not store plaintext
            passwords.
          </li>
          <li>
            <strong>Designs and files.</strong> We process the text, templates, images, settings and
            other content you choose to save or send to hosted features, along with identifiers,
            ownership, revisions, timestamps and file metadata. Cloud designs and their saved
            versions use Firestore. Library originals and thumbnails use Firebase Storage, with
            account-scoped metadata in Firestore.
          </li>
          <li>
            <strong>AI connections and requests.</strong> If you connect a provider, we store its
            connection details, model selection, masked key information and an encrypted copy of
            your API key. Generation processes your prompt, selected design sources and attached
            context, including images you attach for the provider to see.
          </li>
          <li>
            <strong>Hosted agent connections.</strong> The hosted MCP service processes client
            registration, authorization, token and request records needed to connect an external
            agent and authorize its operations.
          </li>
          <li>
            <strong>Technical and security information.</strong> Our hosting and authentication
            providers may process IP addresses, browser or device information, request times, errors
            and service logs to deliver, secure and operate the service. We also maintain
            authorization, quota and rate-limit records.
          </li>
        </ul>
      </section>
      <section>
        <h2>2. Browser storage and local work</h2>
        <p>
          The site uses necessary browser storage, including local storage and sign-in storage
          managed by Firebase, to remember appearance, welcome-guide preferences, authentication,
          browser drafts, source recovery and private guest edit keys. Local editing and preview do
          not require sending a design to an AI provider. Saving a cloud link, uploading media or
          using hosted generation or rendering sends the information needed for that feature.
        </p>
        <p>
          Prompt history is session-only and is not stored by the application as a persistent
          conversation. Generated content you save becomes part of the design. Attaching an image
          while signed in also saves the image to My Library, even if you do not send a generation
          request. Text attachments are not Library files.
        </p>
        <p>
          We do not add advertising trackers or product analytics to the site, or sell personal
          information through this service. Third-party sign-in pages and services may use their own
          cookies or storage under their policies. Clearing this site's browser storage can remove
          drafts and private guest edit keys; download important work first.
        </p>
      </section>
      <section>
        <h2>3. Public design links and private Library files</h2>
        <div className="legal-callout">
          <p>
            <strong>A saved cloud design is viewable by anyone with its public link.</strong>{" "}
            Account ownership protects editing, not viewing. The current design, including images
            embedded in it, can be viewed and copied by someone with the link. Treat the link and
            its contents as shareable, not as confidential storage.
          </p>
        </div>
        <p>
          Library originals and thumbnails are account-private and are read through authenticated
          services, not public bucket download links. Placing an uploaded image in a design creates
          an embedded copy. Deleting its Library original does not remove copies already embedded in
          designs, downloaded, exported or shared with others.
        </p>
      </section>
      <section>
        <h2>4. How we use information</h2>
        <p>
          We use information to authenticate users, provide editing and saving, display public
          design links, retain and deliver files, carry out requested AI and rendering operations,
          manage connections, respond to support or privacy requests, prevent abuse, troubleshoot
          failures and comply with applicable law. We do not use your content to train our own AI
          models.
        </p>
        <p>
          Where data-protection law requires a legal basis, processing may be necessary to provide
          the service you request, support legitimate interests in security and operation, comply
          with legal duties or act on consent where consent is required. You can choose not to use
          optional hosted or AI features.
        </p>
      </section>
      <section>
        <h2>5. Service providers and AI sharing</h2>
        <p>
          We use Google Firebase and Google Cloud for hosting, authentication, databases, storage,
          secret management and server-side processing. Information is shared with these service
          providers as needed to operate the service.
        </p>
        <p>
          When you request AI generation, relevant content and credentials are sent to the provider
          you selected, such as OpenAI, Anthropic, Google or an approved compatible provider. Model
          discovery also sends an authenticated request to that provider. Your provider's terms,
          account settings, retention, training practices and processing locations apply
          independently. We cannot promise that every provider has the same privacy practices. Do
          not send information you are not authorized to share.
        </p>
        <p>
          We may disclose information where reasonably necessary to comply with law, respond to
          lawful requests, protect rights or safety, prevent abuse or support a business transfer
          subject to applicable safeguards. Public links and content you choose to share may also
          reach recipients outside our control.
        </p>
      </section>
      <section>
        <h2>6. Retention and deletion</h2>
        <p>
          Cloud designs, saved versions and Library files are retained until you delete them or
          request applicable deletion, subject to legal and security needs. Temporary render
          downloads expire and are cleaned up separately; they are not permanent storage. Browser
          drafts remain subject to your browser's storage settings.
        </p>
        <p>
          Disconnecting an AI connection removes its stored credential from the service but does not
          revoke the key at its provider. You can revoke it with that provider. Limited deletion
          markers, authorization and security records may remain to prevent abuse or delayed
          requests from recreating deleted content. Service logs and any provider backups follow the
          applicable retention settings and legal requirements.
        </p>
        <p>
          You can delete individual designs and Library files using their controls. Contact us for
          account-deletion or other privacy requests. Removing an account does not necessarily
          remove separately saved public designs or copies held by other people; identify the
          relevant designs when requesting deletion.
        </p>
      </section>
      <section>
        <h2>7. Security and international processing</h2>
        <p>
          We use HTTPS, authenticated access controls for private files and server-side encryption
          of saved provider keys. Trusted server code can decrypt a saved key to perform your
          requests; this is not end-to-end encryption. No system guarantees absolute security or
          uninterrupted availability.
        </p>
        <p>
          We operate in the United States. Google Cloud, authentication services and your chosen AI
          provider may process information in the United States and other countries, which may have
          different data-protection laws. Applicable safeguards and provider arrangements govern
          transfers where required.
        </p>
      </section>
      <section>
        <h2>8. Your choices and rights</h2>
        <p>
          Depending on your location and applicable law, you may have rights to access, correct,
          receive a copy of or delete personal information, restrict or object to processing,
          withdraw consent where processing relies on consent, or complain to a data-protection
          authority. Contact us to make a request or appeal a privacy-request decision. We may need
          to verify your identity and account ownership. Rights may be subject to lawful exceptions;
          we will respond as required by applicable law.
        </p>
      </section>
      <section>
        <h2>9. Adults only</h2>
        <p>
          The hosted service is intended for people aged 18 or older. We do not knowingly seek
          personal information from anyone under 18. If you believe a minor has provided
          information, contact us so we can investigate and take appropriate action.
        </p>
      </section>
      <section>
        <h2>10. Changes and contact</h2>
        <p>
          We may update this policy and will show the updated effective date on this page.
          Additional notice will be provided where required by law. For privacy questions or
          requests, contact {operatorName} at <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
        <p>
          See also our{" "}
          <SiteLink href="/terms" onNavigate={onNavigate}>
            Terms and Conditions
          </SiteLink>
          .
        </p>
      </section>
    </>
  );
}

function TermsAndConditions({ onNavigate }: { onNavigate: (path: string) => void }) {
  return (
    <>
      <p>
        These Terms and Conditions govern your use of the hosted tinytldr website, rendering API and
        MCP service provided by {operatorName}. By using the hosted service, you agree to these
        terms. If you do not agree, do not use the hosted service.
      </p>
      <section>
        <h2>1. Eligibility and accounts</h2>
        <p>
          You must be at least 18 years old and able to enter a binding agreement. If you use the
          service for an organization, you represent that you have authority to bind it. Keep
          account information accurate, protect your sign-in credentials and provider API keys, and
          notify us of suspected unauthorized use.
        </p>
        <p>
          Guest editing is available without an account. Some hosted features require sign-in.
          Private guest edit keys are kept in your browser; losing them can prevent further editing
          of an unclaimed design. We cannot promise recovery of lost browser drafts, credentials or
          private keys.
        </p>
      </section>
      <section>
        <h2>2. Hosted service and open-source software</h2>
        <p>
          tinytldr provides design authoring, templates, preview, storage, rendering and optional
          AI-assisted generation. Features, storage capacity and usage limits may change.
          Availability is not guaranteed.
        </p>
        <p>
          The open-source code is available under its included MIT license, and third-party
          components retain their own licenses. These hosted-service terms do not replace or
          restrict rights granted by those software licenses. Independently self-hosted
          installations are operated by their own operators, not automatically by {operatorName}.
        </p>
      </section>
      <section>
        <h2>3. Your content and permissions</h2>
        <p>
          You retain whatever rights you have in the content you submit. You are responsible for
          having the rights and permissions needed to upload, process, publish and share it,
          including images, logos, trademarks and personal information.
        </p>
        <p>
          You grant us permission to host, store, copy, process, transmit and display that content
          as needed to provide and secure the service and carry out your instructions, including
          public-link viewing, rendering and requests to your selected AI provider. Uploading
          content does not automatically license it to the public under MIT or transfer its
          ownership to us.
        </p>
      </section>
      <section>
        <h2>4. Public links, files and backups</h2>
        <p>
          Saved cloud designs are public-by-link: anyone with the link can view and copy the current
          design, including embedded images. Ownership controls editing, not private viewing. Do not
          save confidential content to a public design link.
        </p>
        <p>
          Library files are account-private, but exported, downloaded or embedded copies may remain
          after the original is deleted. Temporary render URLs expire. Keep independent backups of
          important work; the service is not an archival or guaranteed backup system.
        </p>
      </section>
      <section>
        <h2>5. AI providers and other third-party services</h2>
        <p>
          AI generation is optional and uses your own provider connection. You are responsible for
          the provider account, permissions, API charges, quotas and compliance with its terms.
          Consumer AI subscriptions may not include API access. Cancelling a request may not stop
          provider processing or prevent charges already incurred.
        </p>
        <p>
          AI output may be inaccurate, incomplete, inappropriate or similar to other content. We do
          not guarantee its accuracy, uniqueness, legal suitability, copyright protection or freedom
          from third-party rights. Review generated content and exports before using or publishing
          them. Third-party authentication, infrastructure and AI services are also subject to their
          own terms and availability.
        </p>
      </section>
      <section>
        <h2>6. Acceptable use</h2>
        <p>
          Do not use the hosted service for unlawful activity, fraud, infringement, harassment or
          unauthorized disclosure of another person's information. Do not introduce malware, attempt
          unauthorized access, bypass authentication or usage limits, interfere with the service or
          other users, or misrepresent your authority to use an account or API key.
        </p>
        <p>
          You are responsible for your submissions and resulting uses, including compliance with
          applicable laws and third-party rights. Report suspected abuse or infringement to{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      </section>
      <section>
        <h2>7. Privacy</h2>
        <p>
          Our{" "}
          <SiteLink href="/privacy" onNavigate={onNavigate}>
            Privacy Policy
          </SiteLink>{" "}
          explains account data, browser storage, public design links, private Library files and
          sharing with your selected AI provider. Do not send content you are not authorized to
          share with the services involved.
        </p>
      </section>
      <section>
        <h2>8. Suspension and termination</h2>
        <p>
          We may restrict or suspend access, remove content or discontinue a hosted feature where
          reasonably necessary for security, legal compliance, abuse prevention or a violation of
          these terms. You may stop using the service at any time, delete individual designs and
          Library files through their controls, and contact us about account deletion. Open-source
          license rights remain governed by their applicable licenses.
        </p>
      </section>
      <section>
        <h2>9. Disclaimers and responsibility</h2>
        <p>
          To the extent permitted by law, the hosted service is provided "as is" and "as available,"
          without warranties of merchantability, fitness for a particular purpose, non-infringement,
          continuous availability or error-free operation. We do not guarantee that content will be
          preserved or that any output will meet your requirements.
        </p>
        <p>
          To the extent permitted by law, {operatorName} is not responsible for indirect,
          incidental, special or consequential losses, including lost profits, lost opportunities or
          loss of data arising from use of or inability to use the service. Nothing in these terms
          excludes or limits liability that cannot lawfully be excluded or limited, or overrides
          mandatory consumer or other statutory rights.
        </p>
      </section>
      <section>
        <h2>10. Governing law and disputes</h2>
        <p>
          These terms are governed by the laws of the Commonwealth of Virginia, United States, and
          applicable United States federal law, without applying conflict-of-law rules. Disputes may
          be brought in courts of competent jurisdiction in Virginia, except where mandatory law
          gives you a different right or requires another forum. Contact us first if you would like
          to try to resolve a concern informally.
        </p>
      </section>
      <section>
        <h2>11. Changes and contact</h2>
        <p>
          We may update these terms prospectively and will publish an updated effective date.
          Additional notice or agreement will be obtained where required by law. If a provision is
          unenforceable, the remaining provisions continue to apply to the extent allowed by law.
        </p>
        <p>
          For questions about these terms, contact {operatorName} at{" "}
          <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
        </p>
      </section>
    </>
  );
}

export function LegalPage(props: {
  page: "privacy" | "terms";
  workspacePath: string;
  onNavigate: (path: string) => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const title = props.page === "privacy" ? "Privacy Policy" : "Terms and Conditions";
  useEffect(() => {
    container.current?.scrollTo({ top: 0 });
    heading.current?.focus({ preventScroll: true });
  }, [props.page]);
  return (
    <div className="legal-page" ref={container}>
      <article className="legal-document" aria-labelledby="legal-title">
        <header className="legal-header">
          <SiteLink href={props.workspacePath} onNavigate={props.onNavigate} className="legal-back">
            <ArrowLeft size={14} aria-hidden="true" /> Back to workspace
          </SiteLink>
          <p className="eyebrow">tinytldr / {operatorName}</p>
          <h1 id="legal-title" ref={heading} tabIndex={-1}>
            {title}
          </h1>
          <p className="legal-effective">
            Effective <time dateTime="2026-11-03">November 3, 2026</time>
          </p>
        </header>
        {props.page === "privacy" ? (
          <PrivacyPolicy onNavigate={props.onNavigate} />
        ) : (
          <TermsAndConditions onNavigate={props.onNavigate} />
        )}
      </article>
    </div>
  );
}
