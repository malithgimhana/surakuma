import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { api } from './api';
import { Button, Card, ErrorState, Field, PageHeader } from './components';
import { useCountry } from './geography';

const topics = ['request', 'medicine', 'track', 'centres', 'shelters'] as const;
const copy = {
  en: ['Ask for help', 'Choose a question about using Surakuma.', 'How do I ask for assistance?', 'Where do I request medicine?',
    'How do I track my request?', 'Where are the assistance centres?', 'Where can I find shelters?', 'Open this page', 'Official Surakuma guidance', 'AI explanation'],
  si: ['උදව් ලබාගන්න', 'සුරකුම භාවිතය පිළිබඳ ප්‍රශ්නයක් තෝරන්න.', 'ආධාර ඉල්ලන්නේ කෙසේද?', 'ඖෂධ ඉල්ලන්නේ කොහෙන්ද?',
    'මගේ ඉල්ලීම නිරීක්ෂණය කරන්නේ කෙසේද?', 'ආධාර මධ්‍යස්ථාන කොහේද?', 'නවාතැන් සොයා ගන්නේ කොහෙන්ද?', 'මෙම පිටුව විවෘත කරන්න',
    'සුරකුම නිල මාර්ගෝපදේශය', 'AI පැහැදිලි කිරීම'],
  ta: ['உதவி பெறுங்கள்', 'சுரகுமாவைப் பயன்படுத்துவது பற்றிய கேள்வியைத் தேர்ந்தெடுக்கவும்.', 'உதவியை எவ்வாறு கோருவது?', 'மருந்தை எங்கே கோருவது?',
    'எனது கோரிக்கையை எவ்வாறு கண்காணிப்பது?', 'உதவி மையங்கள் எங்கே?', 'தங்குமிடங்களை எங்கே காணலாம்?', 'இந்தப் பக்கத்தைத் திறக்கவும்',
    'சுரகுமாவின் அதிகாரப்பூர்வ வழிகாட்டி', 'AI விளக்கம்'],
  hi: ['मदद पाएँ', 'सुरकुमा के उपयोग से जुड़ा सवाल चुनें।', 'सहायता कैसे माँगें?', 'दवा के लिए कहाँ अनुरोध करें?',
    'मेरा अनुरोध कैसे देखें?', 'सहायता केंद्र कहाँ हैं?', 'आश्रय कहाँ मिलेंगे?', 'यह पेज खोलें', 'सुरकुमा का आधिकारिक मार्गदर्शन', 'AI की व्याख्या'],
  ne: ['मद्दत पाउनुहोस्', 'सुरकुमा प्रयोग गर्नेबारे एउटा प्रश्न छान्नुहोस्।', 'सहायता कसरी माग्ने?', 'औषधि कहाँ माग्ने?',
    'मेरो अनुरोध कसरी हेर्ने?', 'सहायता केन्द्रहरू कहाँ छन्?', 'आश्रय कहाँ भेटिन्छ?', 'यो पृष्ठ खोल्नुहोस्', 'सुरकुमाको आधिकारिक मार्गदर्शन', 'AI व्याख्या'],
} as const;

const searchTerms: Record<typeof topics[number], string[]> = {
  medicine: ['medicin', 'බෙහෙත්', 'ඖෂධ', 'மருந்து', 'दवा', 'औषधि'],
  track: ['track', 'status', 'නිරීක්ෂණ', 'තත්ත්ව', 'கண்காணி', 'நிலை', 'स्थिति', 'ट्रैक', 'अनुरोध हेर्न'],
  centres: ['centre', 'center', 'මධ්‍යස්ථාන', 'மையம்', 'மையங்கள்', 'केंद्र', 'केन्द्र'],
  shelters: ['shelter', 'නවාතැන්', 'தங்குமிடம்', 'தங்குமிடங்', 'आश्रय'],
  request: ['request', 'apply', 'form', 'ඉල්ල', 'விண்ணப்ப', 'கோர', 'अनुरोध', 'सहायता माग'],
};
const questionCopy = {
  en: ['Your question', 'Ask', 'Choose one of the questions above for help with this topic.'],
  si: ['ඔබේ ප්‍රශ්නය', 'අසන්න', 'උදව් සඳහා ඉහත ප්‍රශ්නයක් තෝරන්න.'],
  ta: ['உங்கள் கேள்வி', 'கேளுங்கள்', 'உதவிக்கு மேலுள்ள கேள்விகளில் ஒன்றைத் தேர்ந்தெடுக்கவும்.'],
  hi: ['आपका सवाल', 'पूछें', 'मदद के लिए ऊपर दिए गए सवालों में से एक चुनें।'],
  ne: ['तपाईंको प्रश्न', 'सोध्नुहोस्', 'मद्दतका लागि माथिका प्रश्नमध्ये एउटा छान्नुहोस्।'],
} as const;

interface HelpResult {
  reference: string;
  explanation: string | null;
  path: string;
  source: string;
}

export default function CitizenHelp() {
  const { i18n } = useTranslation();
  const requestedLanguage = (i18n.resolvedLanguage ?? i18n.language).split('-')[0] as keyof typeof copy;
  const language = Object.hasOwn(copy, requestedLanguage) ? requestedLanguage : 'en';
  const country = useCountry();
  return <Guidance key={country + language} country={country} language={language} />;
}

function Guidance({ country, language }: { country: string; language: keyof typeof copy }) {
  const [title, intro, request, medicine, track, centres, shelters, open, official, ai] = copy[language];
  const [questionLabel, ask, chooseTopic] = questionCopy[language];
  const [question, setQuestion] = useState('');
  const [unmatched, setUnmatched] = useState(false);
  const help = useMutation({
    mutationFn: (topic: typeof topics[number]) => api.post<HelpResult>('/citizen/help', { topic, language, country })
      .then(response => response.data),
  });
  function show(topic: typeof topics[number]) {
    setUnmatched(false);
    help.mutate(topic);
  }
  return <div className="citizen-page stack">
    <PageHeader title={title} description={intro} />
    <Card><div className="button-row">
      {[request, medicine, track, centres, shelters].map((question, i) => <Button key={question}
        variant="secondary" busy={help.isPending && help.variables === topics[i]}
        disabled={help.isPending} onClick={() => show(topics[i])}>{question}</Button>)}
    </div>
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        const normalized = question.trim().toLocaleLowerCase();
        const topic = (Object.keys(searchTerms) as typeof topics[number][]).find(key =>
          searchTerms[key].some(term => normalized.includes(term)));
        if (topic) show(topic);
        else { help.reset(); setUnmatched(true); }
      }}>
        <Field label={questionLabel}><input value={question} maxLength={240} required
          onChange={event => setQuestion(event.target.value)} /></Field>
        <div><Button disabled={help.isPending}>{ask}</Button></div>
      </form>
      {unmatched && <p role="status">{chooseTopic}</p>}
    </Card>
    {help.error && <ErrorState error={help.error} />}
    {help.data && <Card>
      <div aria-live="polite">
        {help.data.explanation && <>
          <h2>{ai}</h2><p>{help.data.explanation}</p><small>{help.data.source}</small>
        </>}
        <h2>{official}</h2><p>{help.data.reference}</p>
        <Link className="button primary" to={help.data.path}>{open}</Link>
      </div>
    </Card>}
  </div>;
}
