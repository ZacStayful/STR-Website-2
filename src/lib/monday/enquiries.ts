import 'server-only'

// Helper for the "Stayful Intelligence enquiries" Monday board (18413002067).
// New free-trial signups land here as items in the "Free Trial" group, then
// move through Email Verified -> Trial Expired -> Customer as their state
// changes. Separate from the analyser tracking board (5891626711).

const MONDAY_API_URL = 'https://api.monday.com/v2'
const BOARD_ID = '18413002067'

// Column IDs (see /home/user notes — sourced from get_board_info).
const COL_NAME = 'text_mm3ad9y7'
const COL_EMAIL = 'text_mm3a8s7c'
const COL_MOBILE = 'text_mm3ah0bk'
const COL_EMAIL_VERIFIED = 'boolean_mm3a1wy9'
const COL_STATUS = 'color_mm3a4gp9'

// Group IDs.
const GROUP_FREE_TRIAL = 'topics'
const GROUP_TRIAL_EXPIRED = 'group_mm3a1jys'
const GROUP_CUSTOMER = 'group_mm3ak8fg'

type MondayResponse<T> = {
  data?: T
  errors?: Array<{ message: string }>
  error_message?: string
}

async function mondayFetch<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const apiKey = process.env.MONDAY_API_KEY
  if (!apiKey) {
    throw new Error('MONDAY_API_KEY is not configured')
  }

  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query, variables }),
    cache: 'no-store',
  })

  const body = (await res.json()) as MondayResponse<T>

  if (!res.ok || body.errors || body.error_message) {
    const msg =
      body.errors?.map((e) => e.message).join('; ') ||
      body.error_message ||
      `Monday API ${res.status}`
    throw new Error(`Monday API error: ${msg}`)
  }

  if (!body.data) {
    throw new Error('Monday API returned no data')
  }

  return body.data
}

export type CreateEnquiryInput = {
  name: string
  email: string
  mobile: string
}

/**
 * Create a new "Free Trial" enquiry on board 18413002067 with name/email/mobile
 * populated and Email Verified unchecked. Returns the Monday item id.
 */
export async function createEnquiry(input: CreateEnquiryInput): Promise<string> {
  const columnValues: Record<string, unknown> = {
    [COL_NAME]: input.name,
    [COL_EMAIL]: input.email,
    [COL_MOBILE]: input.mobile,
    [COL_EMAIL_VERIFIED]: { checked: 'false' },
    [COL_STATUS]: { label: 'Free Trial' },
  }

  const query = `
    mutation ($boardId: ID!, $groupId: String!, $itemName: String!, $columnValues: JSON!) {
      create_item(
        board_id: $boardId,
        group_id: $groupId,
        item_name: $itemName,
        column_values: $columnValues
      ) { id }
    }
  `

  const data = await mondayFetch<{ create_item: { id: string } }>(query, {
    boardId: BOARD_ID,
    groupId: GROUP_FREE_TRIAL,
    itemName: input.name || input.email,
    columnValues: JSON.stringify(columnValues),
  })

  return data.create_item.id
}

export async function markEmailVerified(itemId: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) { id }
    }
  `
  await mondayFetch(query, {
    boardId: BOARD_ID,
    itemId,
    columnId: COL_EMAIL_VERIFIED,
    value: JSON.stringify({ checked: 'true' }),
  })
}

async function setStatus(itemId: string, label: string): Promise<void> {
  const query = `
    mutation ($boardId: ID!, $itemId: ID!, $columnId: String!, $value: JSON!) {
      change_column_value(
        board_id: $boardId,
        item_id: $itemId,
        column_id: $columnId,
        value: $value
      ) { id }
    }
  `
  await mondayFetch(query, {
    boardId: BOARD_ID,
    itemId,
    columnId: COL_STATUS,
    value: JSON.stringify({ label }),
  })
}

async function moveToGroup(itemId: string, groupId: string): Promise<void> {
  const query = `
    mutation ($itemId: ID!, $groupId: String!) {
      move_item_to_group(item_id: $itemId, group_id: $groupId) { id }
    }
  `
  await mondayFetch(query, { itemId, groupId })
}

export async function markTrialExpired(itemId: string): Promise<void> {
  await setStatus(itemId, 'Free Trial Expired')
  await moveToGroup(itemId, GROUP_TRIAL_EXPIRED)
}

export async function markCustomer(itemId: string): Promise<void> {
  await setStatus(itemId, 'Customer')
  await moveToGroup(itemId, GROUP_CUSTOMER)
}
