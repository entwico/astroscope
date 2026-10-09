import { useCap } from '@astroscope/cap/react';
import { actions } from 'astro:actions';
import { type SubmitEvent, useState } from 'react';

export default function NewsletterForm() {
  const cap = useCap();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('solving…');

    const _cap = await cap.ensure();

    if (_cap === null) {
      setStatus('solving failed — is the cap service (or `pnpm stub`) running?');

      return;
    }

    const { data, error } = await actions.subscribe({ email, _cap });

    setStatus(error ? `${error.code}: ${error.message}` : `subscribed ${data.subscribed} (#${data.total})`);
  }

  return (
    <form onSubmit={submit} className="flex gap-2 items-end">
      <label className="form-control">
        <span className="label-text">Email</span>
        <input
          type="email"
          className="input input-bordered"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          onFocus={cap.prepare}
          maxLength={200}
          required
        />
      </label>
      <button className="btn btn-primary">Subscribe</button>
      {status && <span className="text-sm">{status}</span>}
    </form>
  );
}
