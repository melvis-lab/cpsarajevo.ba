-- 24 Oct 2026: the admin notification goes out when the applicant confirms the email
drop trigger if exists mail_on_creator on public.creators;
create trigger mail_on_creator after insert or update of status, email_confirmed_at on public.creators
  for each row execute function public.mail_on_creator();
