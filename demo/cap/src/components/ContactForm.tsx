import { CapWidget, useCapWidget } from '@astroscope/cap/react';
import { actions } from 'astro:actions';
import { type SubmitEvent, useState } from 'react';

export default function ContactForm() {
  const widget = useCapWidget();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!widget.token) {
      setStatus('verify first');

      return;
    }

    const { data, error } = await actions.contact({ name, message, _cap: widget.token });

    setStatus(error ? `${error.code}: ${error.message}` : `received: ${data.received}`);

    // a verified token is consumed server-side either way: the next submit needs a fresh solve
    widget.reset();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 items-start">
      <label className="form-control">
        <span className="label-text">Name</span>
        <input
          className="input input-bordered"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
          required
        />
      </label>
      <label className="form-control">
        <span className="label-text">Message</span>
        <textarea
          className="textarea textarea-bordered"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={2000}
          required
        />
      </label>
      <div className="min-h-14.5">
        <CapWidget cap={widget} required labels={{ initialState: 'I\'m human' }} />
      </div>
      <button className="btn btn-primary">Send</button>
      {status && <span className="text-sm">{status}</span>}
    </form>
  );
}
