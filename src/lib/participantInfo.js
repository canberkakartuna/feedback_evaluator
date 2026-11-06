/**
 * The participant information sheet / katılımcı bilgilendirme formu, as approved
 * for the study (UCL Research Ethics Committee), in both languages.
 *
 * This is an ethics document, not interface copy: it lives here rather than in
 * ./strings.js so it is never "tidied" like a UI label, and it is reproduced
 * word for word from the source document. Change it only when the approved
 * text changes. Rendered by components/ParticipantInfoSheet.jsx.
 *
 * Shape per language: `title`, `committee`, `details` ([label, value] pairs),
 * `intro`, `sections` ({ heading, paragraphs }), `closing`.
 */
export const PARTICIPANT_INFO = {
  en: {
    title: 'Participant Information Sheet',
    committee: 'UCL Research Ethics Committee',
    details: [
      ['Title of Study', 'Towards Evaluating Pedagogical Quality of LLM-generated Feedback'],
      ['Department', 'Culture, Communication and Media'],
      ['Name and Contact Details of the Researcher', 'Ebru Toka, ebru.toka.24@ucl.ac.uk'],
      ['Name and Contact Details of the Course Instructor', 'Defne Yabas, defne.yabas@medipol.edu.tr'],
    ],
    intro:
      'You are being invited to take part in a PhD research study. Before you decide, it is important for you to understand why the research is being done and what participation will involve. Please take time to read the following information carefully and discuss it with others if you wish. Ask us if there is anything that is not clear or if you would like more information. Thank you for reading this.',
    sections: [
      {
        heading: '1. What’s the purpose of the study?',
        paragraphs: [
          'As artificial intelligence (AI) tools become more widely available, students may use them to support their independent learning. This study aims to develop an AI-based evaluator to assess the pedagogical quality of the feedback students receive from large language model (LLM)-based tutors while learning mathematics. To this end, feedback collected from student–AI interactions will be examined against specified pedagogical criteria, and the AI evaluator’s judgements will be compared with those of human experts.',
        ],
      },
      {
        heading: '2. Why have I been invited?',
        paragraphs: [
          'You have been invited because you are enrolled in the Mathematics I course. This study focuses on feedback provided by an LLM tutor to undergraduate students working on mathematics problems. As a student taking this course, you are part of the group the research aims to involve.',
        ],
      },
      {
        heading: '3. Do I have to take part?',
        paragraphs: [
          'It is up to you to decide whether or not to take part. If you decide to participate, you will be given a copy of this information sheet to keep and asked to sign a consent form. After giving consent and logging into the system for the first time, you may withdraw from the study at any point during your first session, without giving a reason, by going to the profile section. If you withdraw during this session, you will be asked whether you would like the data you have already provided to be retained or deleted. Once your first session has ended, it will no longer be possible to withdraw the data collected during that session from the study.',
        ],
      },
      {
        heading: '4. What will happen if I take part?',
        paragraphs: [
          'If you choose to participate, you will be invited to solve mathematics problems in an online learning environment that includes an AI tutor based on a large language model (LLM). These problems will form part of the assignments set by your course instructor, so participation will not involve additional assignments beyond your usual coursework.',
          'While working on the problems, you can communicate with the AI tutor through a chat interface whenever you would like support. For example, if you get stuck, do not understand a step, or cannot reach the correct answer, you can ask questions and discuss your approach with the AI tutor. The tutor is intended to support you by providing explanations, hints, and feedback as you work towards a solution.',
          'Your conversations with the AI tutor will be recorded and used to examine the pedagogical quality of the feedback it provides.',
        ],
      },
      {
        heading: '5. What are the possible disadvantages and risks of taking part?',
        paragraphs: [
          'The anticipated risks of taking part are limited. However, the AI tutor may occasionally provide incorrect, misleading, or incomplete explanations and feedback. This may cause confusion or lead you to an incorrect solution. You should therefore consider its responses critically rather than assume they are always correct. If you are unsure about any explanation or feedback, you can check your course materials or ask your course instructor for clarification.',
        ],
      },
      {
        heading: '6. What are the possible benefits of taking part?',
        paragraphs: [
          'There are no guaranteed direct benefits to you from taking part. However, completing your assignments in a structured learning environment with access to immediate explanations, hints, and feedback from an AI tutor may support you as you work through mathematics problems. Your participation will also contribute to research aimed at understanding and evaluating the pedagogical quality of feedback provided by LLM-based tutors.',
        ],
      },
      {
        heading: '7. What if something goes wrong?',
        paragraphs: [
          'If you have any concerns about the way you have been treated during the study, please contact the researcher, Ebru Toka (ebru.toka.24@ucl.ac.uk), in the first instance. If you feel that your concern or complaint has not been resolved satisfactorily, you can contact Defne Yabaş at defne.yabas@medipol.edu.tr.',
        ],
      },
      {
        heading: '8. Will my taking part in this project be kept confidential?',
        paragraphs: [
          'The study will not collect directly identifying information, such as your name or surname. Your data will be recorded using a randomly generated participant code. If you share personal information during your conversations with the chatbot, this information will be identified and removed before the conversations are included in the research dataset. No information that could identify you will be included in any reports or publications arising from the study.',
        ],
      },
      {
        heading: '9. Limits to confidentiality',
        paragraphs: ['Confidentiality will be respected subject to legal constraints and professional guidelines.'],
      },
      {
        heading: '10. What will happen to the results of the study?',
        paragraphs: [
          'The results of this study will be included in the researcher’s PhD thesis and may be presented at academic conferences or published in academic journals. You will not be identified in any report or publication.',
          'The list linking randomly generated participant codes to students’ identities will be held by the course instructor until the end of the course term for grading purposes, if needed. The course instructor will securely destroy this list once the grading process has been completed, and in any event no later than 1 March 2027.',
          'The anonymised research data may also be used in future related research, subject to appropriate ethical approval. These data will be retained for 10 years following any related publication, in accordance with the study’s approved data management plan.',
        ],
      },
      {
        heading: '11. Data Protection Privacy Notice',
        paragraphs: [
          'The controller for this project will be University College London (UCL). The UCL Data Protection Officer provides oversight of UCL activities involving the processing of personal data, and can be contacted at data-protection@ucl.ac.uk.',
          'We are not processing your personal data. Further information on how UCL uses participant information can be found here: https://www.ucl.ac.uk/legal-services/privacy/ucl-general-research-participant-privacy-notice. If you are concerned about how your data is being processed, or if you would like to contact us about your rights, please contact UCL at data-protection@ucl.ac.uk.',
        ],
      },
    ],
    closing:
      'Thank you for reading this information sheet and for considering taking part in this research study.',
  },

  tr: {
    title: 'Katılımcı Bilgilendirme Formu',
    committee: 'UCL Research Ethics Committee',
    details: [
      [
        'Çalışmanın Başlığı',
        'LLM tabanlı öğreticilerin öğrencilere verdiği geri bildirimlerin pedagojik kalitesinin değerlendirilmesi',
      ],
      ['Departman', 'Culture, Communication and Media'],
      ['Araştırmacının Adı ve İletişim Bilgileri', 'Ebru Toka, ebru.toka.24@ucl.ac.uk'],
      ['Dersin Yürütücüsünün Adı ve İletişim Bilgileri', 'Defne Yabaş, defne.yabas@medipol.edu.tr'],
    ],
    intro:
      'Bir doktora araştırmasına katılmaya davet ediliyorsunuz. Katılmaya karar vermeden önce, araştırmanın neden yapıldığını ve katılımınızın neleri içereceğini anlamanız önemlidir. Lütfen aşağıdaki bilgileri dikkatlice okumak için zaman ayırın ve dilerseniz başkalarıyla görüşün. Anlaşılmayan bir nokta varsa veya daha fazla bilgi almak isterseniz bizimle iletişime geçebilirsiniz. Bu bilgilendirme metnini okuduğunuz için teşekkür ederiz.',
    sections: [
      {
        heading: '1. Çalışmanın amacı',
        paragraphs: [
          'Yapay zekâ araçlarının yaygınlaşmasıyla birlikte öğrenciler, bireysel öğrenme süreçlerinde bu araçlardan destek alabilmektedir. Bu çalışmanın amacı, öğrencilerin matematik öğrenirken büyük dil modeli (LLM) tabanlı yapay zekâ öğreticilerinden aldıkları geri bildirimlerin pedagojik kalitesini değerlendirmek üzere yapay zekâ temelli bir değerlendirici geliştirmektir. Bu kapsamda, öğrenci–yapay zekâ etkileşimlerinden elde edilen geri bildirimler belirlenen pedagojik ölçütler doğrultusunda incelenecek ve yapay zekâ değerlendiricisinin değerlendirmeleri uzman değerlendirmeleriyle karşılaştırılacaktır.',
        ],
      },
      {
        heading: '2. Bu araştırmaya neden davet edildim?',
        paragraphs: [
          'Matematik I dersine kayıtlı olduğunuz için bu araştırmaya davet ediliyorsunuz. Bu çalışma, matematik problemleri üzerinde çalışan lisans öğrencilerine büyük dil modeli tabanlı öğreticiler tarafından verilen geri bildirimlere odaklanmaktadır. Bu dersi alan bir öğrenci olarak araştırmanın hedef grubunda yer almaktasınız.',
        ],
      },
      {
        heading: '3. Katılmak zorunda mıyım?',
        paragraphs: [
          'Araştırmaya katılıp katılmamak tamamen sizin kararınızdır. Katılmaya karar verirseniz, saklamanız için bu bilgilendirme formunun bir kopyası size verilecek ve bir onam formu imzalamanız istenecektir. Onam verdikten ve sisteme ilk kez giriş yaptıktan sonra, ilk oturumunuz boyunca herhangi bir gerekçe göstermeden profil kısmına giderek araştırmadan çekilebilirsiniz. Bu oturum sırasında çekilmeye karar verirseniz, o ana kadar sağladığınız verilerin saklanmasını mı yoksa silinmesini mi istediğiniz size sorulacaktır. İlk oturumunuz sona erdikten sonra, oturumda toplanan verilerin araştırmadan çıkarılmasını talep etmeniz mümkün olmayacaktır.',
        ],
      },
      {
        heading: '4. Araştırmaya katılırsam ne yapacağım?',
        paragraphs: [
          'Araştırmaya katılmayı seçerseniz, büyük dil modeli (LLM) tabanlı bir yapay zekâ öğreticisinin yer aldığı çevrimiçi bir öğrenme ortamında matematik problemleri çözmeniz istenecektir. Bu problemler, dersin öğretmeninin verdiği ödevlerin bir parçası olacağından, katılımınız olağan ders çalışmalarınızın dışında ek bir ödev yapmanızı gerektirmeyecektir.',
          'Problemler üzerinde çalışırken desteğe ihtiyaç duyduğunuzda, sohbet arayüzü üzerinden yapay zekâ öğreticisiyle iletişim kurabilirsiniz. Örneğin, bir noktada takıldığınızda, bir çözüm adımını anlamadığınızda veya doğru cevaba ulaşamadığınızda sorular sorabilir ve çözüm yaklaşımınızı öğreticiyle tartışabilirsiniz. Yapay zekâ öğreticisinin amacı, çözüme ulaşmaya çalışırken açıklamalar, ipuçları ve geri bildirimler sunarak size destek olmaktır.',
          'Yapay zekâ öğreticisiyle yaptığınız konuşmalar kaydedilecek ve sunduğu geri bildirimlerin pedagojik kalitesini incelemek amacıyla kullanılacaktır.',
        ],
      },
      {
        heading: '5. Araştırmaya katılmanın olası dezavantajları ve riskleri nelerdir?',
        paragraphs: [
          'Araştırmaya katılımın öngörülen riskleri sınırlıdır. Bununla birlikte, yapay zekâ öğreticisi zaman zaman yanlış, yanıltıcı veya eksik açıklamalar ve geri bildirimler sunabilir. Bu durum kafa karışıklığına neden olabilir veya sizi yanlış bir çözüme yönlendirebilir. Bu nedenle, öğreticinin yanıtlarının her zaman doğru olduğunu varsaymak yerine bu yanıtları eleştirel bir şekilde değerlendirmeniz önemlidir. Herhangi bir açıklama veya geri bildirimden emin olmadığınızda ders materyallerinizi kontrol edebilir ya da dersin öğretim elemanından destek alabilirsiniz.',
        ],
      },
      {
        heading: '6. Araştırmaya katılmanın olası faydaları nelerdir?',
        paragraphs: [
          'Araştırmaya katılımınızın size doğrudan bir fayda sağlayacağı garanti edilmemektedir. Bununla birlikte, ödevlerinizi yapılandırılmış bir öğrenme ortamında, yapay zekâ öğreticisinden anlık açıklama, ipucu ve geri bildirim alarak tamamlamak, matematik problemleri üzerinde çalışırken size destek sağlayabilir. Katılımınız ayrıca, büyük dil modeli (LLM) tabanlı öğreticilerin sunduğu geri bildirimlerin pedagojik kalitesini anlamayı ve değerlendirmeyi amaçlayan araştırmalara katkıda bulunacaktır.',
        ],
      },
      {
        heading: '7. Bir sorun yaşarsam ne yapmalıyım?',
        paragraphs: [
          'Araştırma sırasında size yönelik tutum veya uygulamalarla ilgili herhangi bir endişeniz varsa, lütfen öncelikle araştırmacı Ebru Toka ile ebru.toka.24@ucl.ac.uk üzerinden iletişime geçin. Endişenizin veya şikâyetinizin sizi tatmin edecek şekilde çözüme kavuşturulmadığını düşünüyorsanız, dersin eğitmeni Defne Yabaş ile defne.yabas@medipol.edu.tr üzerinden iletişime geçebilirsiniz.',
        ],
      },
      {
        heading: '8. Bu araştırmaya katılımım gizli tutulacak mı?',
        paragraphs: [
          'Araştırma kapsamında adınız ve soyadınız gibi sizi doğrudan tanımlayan bilgiler toplanmayacak; verileriniz rastgele oluşturulmuş bir katılımcı koduyla kaydedilecektir. Chatbot ile yazışmalarınız sırasında kendinizle ilgili kişisel bilgiler paylaşmanız hâlinde, bu bilgiler konuşmalar araştırma veri setine dâhil edilmeden önce tespit edilerek kaldırılacaktır. Araştırma sonucunda hazırlanacak rapor veya yayınlarda kimliğinizin belirlenmesini sağlayabilecek bilgilere yer verilmeyecektir.',
        ],
      },
      {
        heading: '9. Gizliliğin sınırları',
        paragraphs: ['Yasal gereklilikler ve mesleki ilkeler çerçevesinde gizliliğiniz korunacaktır.'],
      },
      {
        heading: '10. Araştırmanın sonuçları nasıl kullanılacak?',
        paragraphs: [
          'Bu çalışmanın sonuçları, araştırmacının doktora tezinde yer alacak ve akademik konferanslarda sunulabilecek veya akademik dergilerde yayımlanabilecektir. Hiçbir rapor veya yayında kimliğinizi belirleyebilecek bilgilere yer verilmeyecektir.',
          'Rastgele oluşturulan katılımcı kodlarını öğrencilerin kimlikleriyle eşleştiren liste, dersin öğretim elemanı tarafından tutulacak ve gerektiğinde notlandırma amacıyla kullanılmak üzere ders döneminin sonuna kadar saklanacaktır. Bu liste, notlandırma süreci tamamlandığında ve her durumda en geç 1 Mart 2027 tarihinde dersin öğretim elemanı tarafından güvenli bir şekilde imha edilecektir.',
          'Anonimleştirilmiş araştırma verileri, gerekli etik onayların alınması koşuluyla gelecekte ilgili araştırmalarda da kullanılabilecektir. Bu veriler, çalışmanın onaylanmış veri yönetim planı doğrultusunda, ilgili herhangi bir yayının ardından 10 yıl süreyle saklanacaktır.',
        ],
      },
      {
        heading: '11. Veri Koruma ve Gizlilik Bildirimi',
        paragraphs: [
          'Bu projenin veri sorumlusu University College London (UCL) olacaktır. UCL Veri Koruma Görevlisi, UCL’nin kişisel verilerin işlenmesini içeren faaliyetlerini denetler. Kendisiyle data-protection@ucl.ac.uk adresinden iletişime geçilebilir.',
          'Kişisel verilerinizi işlemiyoruz. UCL’nin katılımcı bilgilerini nasıl kullandığına ilişkin daha fazla bilgiye https://www.ucl.ac.uk/legal-services/privacy/ucl-general-research-participant-privacy-notice üzerinden ulaşabilirsiniz. Verilerinizin işlenme şekliyle ilgili endişeleriniz varsa veya haklarınız hakkında bizimle iletişime geçmek isterseniz, data-protection@ucl.ac.uk adresinden UCL ile iletişime geçebilirsiniz.',
        ],
      },
    ],
    closing: 'Bu bilgilendirme formunu okuduğunuz ve araştırmaya katılmayı değerlendirdiğiniz için teşekkür ederiz.',
  },
}

/** The sheet in `lang`, falling back to English like the rest of the interface. */
export const participantInfoFor = (lang) => PARTICIPANT_INFO[lang] ?? PARTICIPANT_INFO.en

/**
 * Splits text into plain runs and links, so emails and URLs in the sheet can be
 * clicked. Pure, so the unit tests can pin it without a DOM.
 * Returns `[{ text }, { text, href }]`.
 */
const LINK = /(https?:\/\/[^\s]+[^\s.,;:)]|[\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g

export function linkify(text) {
  const parts = []
  let last = 0
  for (const match of text.matchAll(LINK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index) })
    const value = match[0]
    parts.push({ text: value, href: value.includes('@') && !value.startsWith('http') ? `mailto:${value}` : value })
    last = match.index + value.length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}
