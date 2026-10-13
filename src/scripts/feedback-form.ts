const FAILURE_MESSAGE = 'Something went wrong. Please try email instead.'

export function bindFeedbackForm(
  form: HTMLFormElement,
  status: HTMLElement,
  options: { buildBody?: (data: FormData) => FormData; onSuccess?: () => void } = {},
): void {
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    status.textContent = 'Sending...'
    const data = options.buildBody ? options.buildBody(new FormData(form)) : new FormData(form)

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        body: data,
        headers: { Accept: 'application/json' },
      })

      if (response.ok) {
        form.reset()
        status.textContent = 'Thanks!'
        options.onSuccess?.()
      } else {
        status.textContent = FAILURE_MESSAGE
      }
    } catch {
      status.textContent = FAILURE_MESSAGE
    }
  })
}
