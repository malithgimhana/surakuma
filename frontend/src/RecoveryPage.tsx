import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { api } from './api';
import { Button, Card, Field } from './components';
const copy: Record<string, string[]> = {
  en: [
    'Reset password',
    'Email',
    'New password',
    'Send reset link',
    'If the account is eligible, reset instructions will be sent.',
    'Password updated. Sign in with your new password.',
    'The request could not be completed. Check your link and password, or try again later.',
    'Back to sign in',
    'Use at least 10 characters, including uppercase and lowercase letters, a number and a symbol.',
  ],
  si: [
    'මුරපදය යළි සකසන්න',
    'ඊමේල්',
    'නව මුරපදය',
    'යළි සැකසුම් සබැඳිය යවන්න',
    'ගිණුම සුදුසු නම්, මුරපදය යළි සැකසීමේ උපදෙස් යවනු ඇත.',
    'මුරපදය යාවත්කාලීන කරන ලදී. නව මුරපදයෙන් පිවිසෙන්න.',
    'ඉල්ලීම සම්පූර්ණ කළ නොහැකි විය. සබැඳිය සහ මුරපදය පරීක්ෂා කරන්න හෝ පසුව නැවත උත්සාහ කරන්න.',
    'පිවිසීමට ආපසු යන්න',
    'විශාල හා කුඩා අකුරු, අංකයක් සහ සංකේතයක් ඇතුළුව අවම අක්ෂර 10ක් භාවිත කරන්න.',
  ],
  ta: [
    'கடவுச்சொல்லை மீட்டமைக்கவும்',
    'மின்னஞ்சல்',
    'புதிய கடவுச்சொல்',
    'மீட்டமைப்பு இணைப்பை அனுப்பு',
    'கணக்கு தகுதியுடையதாக இருந்தால் மீட்டமைப்பு வழிமுறைகள் அனுப்பப்படும்.',
    'கடவுச்சொல் புதுப்பிக்கப்பட்டது. புதிய கடவுச்சொல்லுடன் உள்நுழையவும்.',
    'கோரிக்கையை முடிக்க முடியவில்லை. இணைப்பையும் கடவுச்சொல்லையும் சரிபார்க்கவும் அல்லது பின்னர் முயற்சிக்கவும்.',
    'உள்நுழைவுக்குத் திரும்பு',
    'பெரிய மற்றும் சிறிய எழுத்துகள், எண் மற்றும் குறியீடு உட்பட குறைந்தது 10 எழுத்துகளைப் பயன்படுத்தவும்.',
  ],
  ne: [
    'पासवर्ड रिसेट गर्नुहोस्',
    'इमेल',
    'नयाँ पासवर्ड',
    'रिसेट लिङ्क पठाउनुहोस्',
    'खाता योग्य भएमा रिसेट निर्देशन पठाइनेछ।',
    'पासवर्ड अद्यावधिक भयो। नयाँ पासवर्डले साइन इन गर्नुहोस्।',
    'अनुरोध पूरा हुन सकेन। लिङ्क र पासवर्ड जाँच्नुहोस् वा पछि प्रयास गर्नुहोस्।',
    'साइन इनमा फर्कनुहोस्',
    'ठूला र साना अक्षर, अंक र चिह्नसहित कम्तीमा १० वर्ण प्रयोग गर्नुहोस्।',
  ],
  hi: [
    'पासवर्ड रीसेट करें',
    'ईमेल',
    'नया पासवर्ड',
    'रीसेट लिंक भेजें',
    'यदि खाता पात्र है, तो रीसेट निर्देश भेजे जाएंगे।',
    'पासवर्ड अपडेट हो गया। नए पासवर्ड से साइन इन करें।',
    'अनुरोध पूरा नहीं हुआ। लिंक और पासवर्ड जाँचें या बाद में प्रयास करें।',
    'साइन इन पर वापस जाएँ',
    'बड़े और छोटे अक्षर, अंक और चिह्न सहित कम से कम 10 वर्ण इस्तेमाल करें।',
  ],
};
export function RecoveryPage({ reset = false, donor = false }: { reset?: boolean; donor?: boolean }) {
  const { i18n } = useTranslation();
  const c = copy[i18n.language.split('-')[0]] || copy.en;
  const [values] = useState(() => {
    const p = new URLSearchParams(window.location.hash.slice(1));

    return { email: p.get('email') || '', token: p.get('token') || '' };
  });
  useEffect(() => { if (reset) window.history.replaceState(null, '', window.location.pathname); }, [reset]);
  const action = useMutation({
    mutationFn: (form: FormData) =>
      api.post(reset ? '/auth/reset-password' : '/auth/forgot-password', {
        email: form.get('email'),
        password: form.get('password'),
        token: values.token,
      }),
  });
  return (
    <div className="container section">
      <Card>
        <h1>{c[0]}</h1>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate(new FormData(e.currentTarget));
          }}
        >
          <Field label={c[1]}>
            <input
              type="email"
              name="email"
              required
              defaultValue={values.email}
              autoComplete="email"
            />
          </Field>
          {reset && (
            <Field label={c[2]} hint={c[8]}>
              <input
                type="password"
                name="password"
                minLength={10}
                required
                autoComplete="new-password"
              />
            </Field>
          )}
          <Button busy={action.isPending}>{reset ? c[0] : c[3]}</Button>
          {action.isError && <p role="alert">{c[6]}</p>}
          {action.isSuccess && <p role="status">{reset ? c[5] : c[4]}</p>}
          <Link to={donor ? '/donation/login' : '/login'}>{c[7]}</Link>
        </form>
      </Card>
    </div>
  );
}
