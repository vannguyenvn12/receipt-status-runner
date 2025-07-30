function isForwardedChangeEmail(parsed) {
  const subject = parsed.subject?.trim() || '';
  const body = parsed.text || '';

  const isForwarded =
    body.includes('Forwarded message') || /Từ:.*<.+>/.test(body);

  const isCorrectSubject = subject.includes(
    'We have taken an action on your case'
  );

  console.log('***[Debug] isForwarded', isForwarded);
  console.log('***[Debug] isCorrectSubject', isCorrectSubject);

  return isForwarded && isCorrectSubject;
}

module.exports = isForwardedChangeEmail;
