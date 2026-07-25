import { Link } from 'react-router-dom';
import FadeIn from '../components/FadeIn';

const SECTIONS = [
  {
    title: '1. Acceptance of Terms',
    content: `By accessing or using Voice Box ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service. These terms apply to all users, including students, administrators, and visitors.`,
  },
  {
    title: '2. Description of Service',
    content: `Voice Box is an anonymous feedback platform that enables students to submit concerns, suggestions, and polls to school administrators. The Service includes AI-powered analysis, emotional support features, and administrative tools. The Service is provided "as is" and may be modified or discontinued at any time.`,
  },
  {
    title: '3. Anonymity and Privacy',
    content: `Voice Box is designed to preserve user anonymity. We do not collect IP addresses, device fingerprints, cookies, or other tracking data from student users. Administrators cannot trace submissions to individual students. For complete details, see our Privacy Policy.`,
  },
  {
    title: '4. User Conduct',
    content: `Users agree to: (a) submit only genuine feedback and concerns; (b) not attempt to circumvent anonymity protections; (c) not submit content that is illegal, harmful, threatening, abusive, harassing, defamatory, or otherwise objectionable; (d) not impersonate others or submit false information.`,
  },
  {
    title: '5. AI-Generated Content',
    content: `The Service uses artificial intelligence to analyze submissions, generate responses, and provide insights. AI-generated content is provided for informational purposes and should not be considered professional advice. School administrators are responsible for reviewing and approving AI-generated responses before sending.`,
  },
  {
    title: '6. Intellectual Property',
    content: `The Service, including its original content, features, and functionality, is owned by Voice Box and protected by copyright, trademark, and other intellectual property laws. Users retain ownership of content they submit through the Service.`,
  },
  {
    title: '7. Limitation of Liability',
    content: `To the maximum extent permitted by law, Voice Box shall not be liable for any indirect, incidental, special, consequential, or punitive damages, or any loss of profits or revenues, whether incurred directly or indirectly, or any loss of data, use, goodwill, or other intangible losses.`,
  },
  {
    title: '8. Disclaimer of Warranties',
    content: `The Service is provided "AS IS" without warranties of any kind, whether express or implied, including but not limited to implied warranties of merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or secure.`,
  },
  {
    title: '9. Indemnification',
    content: `You agree to indemnify, defend, and hold harmless Voice Box, its officers, directors, employees, and agents from any claims, damages, losses, liabilities, and expenses (including reasonable attorneys' fees) arising from your use of the Service or violation of these terms.`,
  },
  {
    title: '10. Termination',
    content: `We may terminate or suspend your access to the Service immediately, without prior notice, for any reason, including breach of these terms. Upon termination, your right to use the Service ceases immediately.`,
  },
  {
    title: '11. Governing Law',
    content: `These terms shall be governed by and construed in accordance with the laws of the State of Delaware, United States, without regard to its conflict of law provisions. Any disputes shall be resolved in the state or federal courts located in Delaware.`,
  },
  {
    title: '12. Changes to Terms',
    content: `We reserve the right to modify these terms at any time. Changes will be effective immediately upon posting. Your continued use of the Service after changes constitutes acceptance of the new terms.`,
  },
  {
    title: '13. Contact',
    content: `For questions about these Terms, please contact us at legal@voicebox.app or through our Contact page.`,
  },
];

export default function Terms() {
  return (
    <div className="min-h-screen bg-bg">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-accent/5 via-transparent to-transparent" />
        <div className="relative max-w-3xl mx-auto px-6 pt-24 pb-12 md:pt-32 md:pb-16 text-center">
          <FadeIn>
            <h1 className="text-4xl md:text-5xl font-bold text-ink mb-4">Terms of Service</h1>
            <p className="text-ink3">Last updated: January 2026</p>
          </FadeIn>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-12">
        <FadeIn>
          <div className="prose prose-ink max-w-none">
            {SECTIONS.map((s, i) => (
              <div key={i} className="mb-8">
                <h2 className="text-xl font-semibold text-ink mb-3">{s.title}</h2>
                <p className="text-ink2 leading-relaxed">{s.content}</p>
              </div>
            ))}
          </div>
        </FadeIn>

        <div className="mt-12 text-center text-sm text-ink3">
          <p>Questions? <Link to="/contact" className="text-accent hover:underline">Contact us</Link></p>
        </div>
      </section>
    </div>
  );
}
