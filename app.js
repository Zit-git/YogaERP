const emptyState = () => ({
  programs: [],
  courses: [],
  rooms: [],
  blocks: [],
  floors: [],
  halls: [],
  hallBookings: [],
  teachers: [],
  participants: []
});

const state = emptyState();
let currentSession = loadCachedSession();
const supabaseClient = createSupabaseClient();
let accessRoles = [];
let accessUsers = [];
let hasLoadedRemoteData = false;
let isHydratingRemoteData = false;
let remoteSaveTimer = null;
let remoteStatus = supabaseClient ? "Supabase connecting" : "Supabase not configured";
let supportsCourseTeacherIds = true;
let supportsBatchStatus = true;
let supportsNormalizedSessions = true;
let supportsTeacherProfileFields = true;
let supportsRegistrationAccommodationType = true;
let supportsRegistrationStayDates = true;
let supportsRoomOperations = true;
let supportsCoursePricing = true;
let supportsRegistrationPayment = true;
let currentFilter = "all";
let programListFilter = "active";
let portalProgramFilter = "";
let portalProgramSort = "startAsc";
let portalProgramPage = 1;
const portalProgramPageSize = 5;
let calendarDate = getInitialCalendarDate();
let selectedCourseId = "";
let selectedProgramId = "";
let selectedParticipantId = "";
let selectedTeacherId = "";
let linkBackStack = [];
let courseMasterTab = "details";
let accommodationTab = "blocks";
let hallTab = "halls";
let roomAvailabilityFilter = { start: "", end: "", type: "All" };
let openDetailView = { courses: false, programs: false, teachers: false, participants: false };
const tableState = {};
const bulkSelections = {};
const tablePageSize = 8;
const roomTypes = ["Single Occupancy", "Double Occupancy", "Dormitory"];
const accommodationTypes = ["Not Required", ...roomTypes];
const roomStatuses = ["Clean", "Cleaning", "Dirty", "Maintenance"];
const defaultPricingTiers = [
  { category: "General", amount: 1500 },
  { category: "Students", amount: 150 },
  { category: "Refresher", amount: 750 }
];
const paymentStatuses = ["Enquiry", "Payment Pending", "Paid", "Approved"];

const views = [
  ["portal", "Portal"],
  ["dashboard", "Dashboard"],
  ["programs", "Courses"],
  ["courses", "Programs"],
  ["teachers", "Teachers"],
  ["registrations", "Registrations"],
  ["participants", "Participants"],
  ["accommodation", "Accommodations"],
  ["allotments", "Room Allotments"],
  ["halls", "Program Halls"],
  ["certificates", "Certificates"],
  ["access", "Users & Roles"]
];

const navGroups = [
  {
    label: "Management",
    items: [
      ["dashboard", "Dashboard"],
      ["courses", "Programs"],
      ["registrations", "Registrations"],
      ["allotments", "Room Allotments"],
      ["certificates", "Certificates"]
    ]
  },
  {
    label: "Masters",
    items: [
      ["programs", "Courses"],
      ["teachers", "Teachers"],
      ["participants", "Participants"],
      ["accommodation", "Accommodations"],
      ["halls", "Program Halls"]
    ]
  },
  {
    label: "Settings",
    items: [
      ["access", "Users & Roles"]
    ]
  }
];
const navViews = navGroups.flatMap((group) => group.items);

const roleViews = {
  public: [],
  participant: ["courses", "participants", "certificates"],
  teacher: ["courses", "participants", "teachers"],
  admin: [...navViews.map(([id]) => id)]
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

migrateState();

function createSupabaseClient() {
  const config = window.ALIYAR_SUPABASE || {};
  const hasConfig = config.url && config.anonKey;
  if (!hasConfig || !window.supabase?.createClient) return null;
  return window.supabase.createClient(config.url, config.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
}

function createSupabaseSignupClient() {
  const config = window.ALIYAR_SUPABASE || {};
  if (!config.url || !config.anonKey || !window.supabase?.createClient) return null;
  return window.supabase.createClient(config.url, config.anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
}

async function loadRemoteData() {
  if (!supabaseClient) {
    remoteStatus = "Supabase not configured";
    renderAuthState();
    return;
  }
  try {
    remoteStatus = "Loading Supabase data";
    renderAuthState();
    await refreshAuthSession();
    renderNav();
    const relationalState = await loadRelationalData();
    Object.keys(state).forEach((key) => delete state[key]);
    Object.assign(state, relationalState);
    migrateState();
    const lifecycleChanged = applyProgramLifecycleStatuses();
    remoteStatus = hasAnyRecords(state) ? "Supabase connected" : "Supabase connected - no records yet";
    hasLoadedRemoteData = true;
    await loadAccessManagementData();
    calendarDate = getInitialCalendarDate();
    isHydratingRemoteData = true;
    renderAll();
    isHydratingRemoteData = false;
    if (!canAccessView(currentViewId())) activateView(defaultViewForRole());
    renderNav();
    if (lifecycleChanged) persistRemoteData();
  } catch (error) {
    remoteStatus = "Data connection unavailable";
    hasLoadedRemoteData = false;
    isHydratingRemoteData = false;
    renderAuthState();
    showToast(friendlyErrorMessage(error, "Unable to load data from Supabase. Please refresh and try again."));
  }
}

async function loadAccessManagementData() {
  if (!supabaseClient) return;
  const [rolesResult, usersResult] = await Promise.all([
    supabaseClient.from("roles").select("*").order("name", { ascending: true }),
    supabaseClient.from("user_roles").select("*").order("display_name", { ascending: true })
  ]);
  if (rolesResult.error) throw rolesResult.error;
  if (usersResult.error) throw usersResult.error;
  accessRoles = rolesResult.data || [];
  accessUsers = currentSession.permissions?.canManageMasters
    ? usersResult.data || []
    : (usersResult.data || []).filter((user) => user.active !== false && isTeacherRole(user.role_id));
}

async function refreshAuthSession() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data.session?.user) {
    currentSession = publicSession();
    cacheCurrentSession();
    return;
  }
  await applyAuthUserSession(data.session.user);
}

async function applyAuthUserSession(user, { showError = false } = {}) {
  const { data: roleRecord, error } = await supabaseClient
    .from("user_roles")
    .select("role_id, display_name, linked_teacher_id, linked_participant_id, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (error || !roleRecord) {
    currentSession = publicSession();
    cacheCurrentSession();
    if (showError) showToast("Login found, but no role is assigned in Supabase.");
    return false;
  }
  const { data: role, error: roleError } = await supabaseClient
    .from("roles")
    .select("id, name, can_manage_masters, can_review_registrations, can_mark_attendance, active")
    .eq("id", roleRecord.role_id)
    .eq("active", true)
    .maybeSingle();
  if (roleError || !role) {
    currentSession = publicSession();
    cacheCurrentSession();
    if (showError) showToast("Login found, but the assigned role is inactive or missing.");
    return false;
  }
  const linkedId = role.id === "participant" ? roleRecord.linked_participant_id : role.id === "teacher" ? roleRecord.linked_teacher_id : user.id;
  currentSession = {
    role: role.id,
    id: linkedId || user.id,
    userId: user.id,
    email: user.email || "",
    name: roleRecord.display_name || user.email || role.name || "User",
    permissions: {
      canManageMasters: Boolean(role.can_manage_masters),
      canReviewRegistrations: Boolean(role.can_review_registrations),
      canMarkAttendance: Boolean(role.can_mark_attendance)
    }
  };
  cacheCurrentSession();
  return true;
}

async function fetchSupabaseRows(tableName) {
  const { data, error } = await supabaseClient.from(tableName).select("*");
  if (error) throw error;
  return data || [];
}

async function fetchOptionalSupabaseRows(tableName) {
  const { data, error } = await supabaseClient.from(tableName).select("*");
  if (error) return { rows: [], supported: false, error };
  return { rows: data || [], supported: true, error: null };
}

async function detectCourseTeacherIdsSupport() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("course_masters").select("teacher_ids").limit(1);
  supportsCourseTeacherIds = !error;
}

async function detectBatchStatusSupport() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("batches").select("status").limit(1);
  supportsBatchStatus = !error;
}

async function detectNormalizedSessionsSupport() {
  if (!supabaseClient) return;
  const [courseSessions, batchSessions, attendance] = await Promise.all([
    supabaseClient.from("course_session_templates").select("id").limit(1),
    supabaseClient.from("batch_sessions").select("id").limit(1),
    supabaseClient.from("session_attendance").select("id").limit(1)
  ]);
  supportsNormalizedSessions = !courseSessions.error && !batchSessions.error && !attendance.error;
}

async function detectTeacherProfileFieldsSupport() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("teachers").select("title,first_name,last_name,contact_number,education,gender,marital_status").limit(1);
  supportsTeacherProfileFields = !error;
}

async function detectRegistrationAccommodationTypeSupport() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("registrations").select("accommodation_type").limit(1);
  supportsRegistrationAccommodationType = !error;
}

async function detectRegistrationStayDatesSupport() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("registrations").select("checkin_date, checkout_date, checked_out").limit(1);
  supportsRegistrationStayDates = !error;
}

async function detectRoomOperationsSupport() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("rooms").select("status, cleaning_notes").limit(1);
  supportsRoomOperations = !error;
}

async function detectCoursePricingSupport() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("course_masters").select("pricing_tiers").limit(1);
  supportsCoursePricing = !error;
}

async function detectRegistrationPaymentSupport() {
  if (!supabaseClient) return;
  const { error } = await supabaseClient.from("registrations").select("pricing_category, amount, payment_status").limit(1);
  supportsRegistrationPayment = !error;
}

function groupRowsBy(rows, key) {
  return (rows || []).reduce((groups, row) => {
    const value = row[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(row);
    return groups;
  }, new Map());
}

function normalizedCourseTemplates(rows, fallback = []) {
  if (!rows?.length) return fallback;
  return [...rows]
    .sort((a, b) => Number(a.day_number || 0) - Number(b.day_number || 0) || (a.time || "").localeCompare(b.time || ""))
    .map((row) => ({
      id: row.id,
      day: Number(row.day_number) || 1,
      title: row.title || "",
      time: row.time || "",
      topic: row.topic || ""
    }));
}

function normalizedBatchSessions(rows, fallback = []) {
  if (!rows?.length) return fallback;
  return [...rows]
    .sort((a, b) => (a.session_date || "").localeCompare(b.session_date || "") || (a.time || "").localeCompare(b.time || ""))
    .map((row) => ({
      id: row.id,
      date: row.session_date || "",
      title: row.title || "",
      time: row.time || "",
      topic: row.topic || ""
    }));
}

function normalizedSessionAttendance(rows, fallback = []) {
  if (!rows?.length) return fallback;
  return [...rows]
    .sort((a, b) => (a.marked_at || "").localeCompare(b.marked_at || ""))
    .map((row) => ({
      sessionId: row.batch_session_id,
      status: row.status || "Present",
      reason: row.reason || ""
    }));
}

async function loadRelationalData() {
  await detectCourseTeacherIdsSupport();
  await detectBatchStatusSupport();
  await detectNormalizedSessionsSupport();
  await detectTeacherProfileFieldsSupport();
  await detectRegistrationAccommodationTypeSupport();
  await detectRegistrationStayDatesSupport();
  await detectRoomOperationsSupport();
  await detectCoursePricingSupport();
  await detectRegistrationPaymentSupport();
  const [
    courseMasters,
    teachers,
    halls,
    blocks,
    floors,
    rooms,
    batches,
    participants,
    registrations,
    hallBookings,
    courseSessionTemplates,
    batchSessions,
    sessionAttendance
  ] = await Promise.all([
    fetchSupabaseRows("course_masters"),
    fetchSupabaseRows("teachers"),
    fetchSupabaseRows("program_halls"),
    fetchSupabaseRows("accommodation_blocks"),
    fetchSupabaseRows("accommodation_floors"),
    fetchSupabaseRows("rooms"),
    fetchSupabaseRows("batches"),
    fetchSupabaseRows("participants"),
    fetchSupabaseRows("registrations"),
    fetchSupabaseRows("hall_bookings"),
    supportsNormalizedSessions ? fetchOptionalSupabaseRows("course_session_templates") : { rows: [] },
    supportsNormalizedSessions ? fetchOptionalSupabaseRows("batch_sessions") : { rows: [] },
    supportsNormalizedSessions ? fetchOptionalSupabaseRows("session_attendance") : { rows: [] }
  ]);
  const courseTemplateRows = courseSessionTemplates.rows || [];
  const batchSessionRows = batchSessions.rows || [];
  const attendanceRows = sessionAttendance.rows || [];
  const courseTemplatesByProgram = groupRowsBy(courseTemplateRows, "program_id");
  const batchSessionsByBatch = groupRowsBy(batchSessionRows, "batch_id");
  const attendanceByRegistration = groupRowsBy(attendanceRows, "registration_id");
  const nextState = {
    programs: courseMasters.map((program) => ({
      id: program.id,
      parentId: program.parent_id || "",
      code: program.code || "",
      name: program.name,
      level: program.level || "",
      duration: program.duration || "",
      eligibility: program.eligibility || "",
      sessionTemplates: normalizedCourseTemplates(courseTemplatesByProgram.get(program.id), program.session_templates || []),
      teacherIds: program.teacher_ids || [],
      pricingTiers: normalizePricingTiers(program.pricing_tiers)
    })),
    teachers: teachers.map((teacher) => {
      const splitName = splitTeacherName(teacher.name);
      return {
        id: teacher.id,
        title: teacher.title || "",
        firstName: teacher.first_name || splitName.firstName,
        lastName: teacher.last_name || splitName.lastName,
        name: teacher.name,
        speciality: teacher.speciality || "",
        phone: teacher.phone || "",
        email: teacher.email || "",
        photo: teacher.photo || "",
        contactNumber: teacher.contact_number || "",
        education: teacher.education || "",
        gender: teacher.gender || "",
        maritalStatus: teacher.marital_status || "",
        notes: teacher.notes || ""
      };
    }),
    halls: halls.map((hall) => ({
      id: hall.id,
      name: hall.name,
      capacity: Number(hall.capacity) || 1,
      location: hall.location || "",
      notes: hall.notes || ""
    })),
    blocks: blocks.map((block) => ({
      id: block.id,
      name: block.name,
      gender: "",
      notes: block.notes || ""
    })),
    floors: floors.map((floor) => ({
      id: floor.id,
      blockId: floor.block_id || "",
      name: floor.name
    })),
    rooms: rooms.map((room) => ({
      id: room.id,
      blockId: room.block_id || "",
      floorId: room.floor_id || "",
      name: room.name,
      gender: normalizeRoomType(room.gender),
      beds: Number(room.beds) || 1,
      status: normalizeRoomStatus(room.status),
      cleaningNotes: room.cleaning_notes || ""
    })),
    courses: batches.map((batch) => {
      const hall = halls.find((item) => item.id === batch.hall_id);
      return {
        id: batch.id,
        programId: batch.program_id || "",
        name: batch.name,
        start: batch.start_date || "",
        end: batch.end_date || "",
        seats: Number(batch.seats) || 1,
        hallId: batch.hall_id || "",
        hall: hall?.name || "",
        teacher: batch.teacher_name || teachers.find((teacher) => teacher.id === batch.teacher_id)?.name || "",
        eligibility: batch.eligibility || "",
        status: batch.status || "",
        sessions: normalizedBatchSessions(batchSessionsByBatch.get(batch.id), batch.sessions || [])
      };
    }),
    participants: participants.map((participant) => ({
      id: participant.id,
      name: participant.name,
      age: Number(participant.age) || "",
      gender: participant.gender || "",
      phone: participant.phone || "",
      email: participant.email || "",
      address: participant.address || "",
      emergencyContact: participant.emergency_contact || "",
      photo: participant.photo || "",
      notes: participant.notes || "",
      programHistory: participant.program_history || [],
      registrations: []
    })),
    hallBookings: hallBookings.map((booking) => ({
      id: booking.id,
      courseId: booking.batch_id || "",
      hallId: booking.hall_id || "",
      start: booking.start_date || "",
      end: booking.end_date || "",
      notes: booking.notes || ""
    }))
  };
  const participantById = new Map(nextState.participants.map((participant) => [participant.id, participant]));
  registrations.forEach((registration) => {
    const participant = participantById.get(registration.participant_id);
    if (!participant) return;
    const batch = nextState.courses.find((course) => course.id === registration.batch_id);
    const program = nextState.programs.find((item) => item.id === batch?.programId);
    const tiers = normalizePricingTiers(program?.pricingTiers);
    const pricingCategory = registration.pricing_category || tiers[0]?.category || "General";
    participant.registrations.push({
      id: registration.id,
      courseId: registration.batch_id || "",
      status: registration.status || "Pending",
      eligible: Boolean(registration.eligible),
      pricingCategory,
      amount: Number(registration.amount) || tiers.find((tier) => tier.category === pricingCategory)?.amount || 0,
      paymentStatus: normalizePaymentStatus(registration.payment_status),
      accommodationType: normalizeAccommodationType(registration.accommodation_type),
      roomId: registration.room_id || "",
      checkedIn: Boolean(registration.checked_in),
      checkedOut: Boolean(registration.checked_out),
      checkinDate: registration.checkin_date || "",
      checkoutDate: registration.checkout_date || "",
      attendance: Number(registration.attendance) || 0,
      completion: registration.completion || "Pending",
      certificate: Boolean(registration.certificate),
      sessionAttendance: normalizedSessionAttendance(attendanceByRegistration.get(registration.id), registration.session_attendance || []),
      notes: registration.notes || "",
      registeredOn: registration.registered_on || new Date().toISOString().slice(0, 10)
    });
  });
  nextState.participants.forEach((participant) => {
    const registration = currentRegistration(participant);
    if (registration) syncParticipantFromRegistration(participant, registration);
  });
  return nextState;
}

function hasAnyRecords(data) {
  return Object.values(data).some((value) => Array.isArray(value) && value.length > 0);
}

function scheduleRemoteSave() {
  if (!supabaseClient || !hasLoadedRemoteData) return;
  clearTimeout(remoteSaveTimer);
  remoteSaveTimer = setTimeout(persistRemoteData, 550);
}

function hasCoreRemoteData() {
  return state.programs.length > 0 || state.courses.length > 0 || state.participants.length > 0 || state.halls.length > 0 || state.blocks.length > 0 || state.rooms.length > 0;
}

async function persistRemoteData() {
  if (!supabaseClient || !hasLoadedRemoteData) return;
  if (!hasCoreRemoteData()) {
    remoteStatus = "Sync skipped - no records loaded";
    renderAuthState();
    return;
  }
  try {
    await syncRelationalTables();
    if (!remoteStatus.includes("course_teacher_associations") && !remoteStatus.includes("batches_status") && !remoteStatus.includes("normalized_sessions")) remoteStatus = "Changes saved";
    renderAuthState();
  } catch (error) {
    remoteStatus = "Save failed - please retry";
    renderAuthState();
    showToast(friendlyErrorMessage(error, "Unable to save changes. Please try again."));
  }
}

async function upsertSupabaseRows(tableName, rows) {
  if (!supabaseClient) return;
  if (!rows.length) return;
  const upsertResult = await supabaseClient.from(tableName).upsert(rows);
  if (upsertResult.error) throw upsertResult.error;
}

async function deleteSupabaseRow(tableName, id) {
  if (!supabaseClient || !hasLoadedRemoteData || !id) return;
  const result = await supabaseClient.from(tableName).delete().eq("id", id);
  if (result.error) showToast(friendlyErrorMessage(result.error, "Unable to delete this record. It may be linked to other records."));
}

async function deleteSupabaseWhere(tableName, column, value) {
  if (!supabaseClient || !hasLoadedRemoteData || !value) return;
  const result = await supabaseClient.from(tableName).delete().eq(column, value);
  if (result.error) showToast(friendlyErrorMessage(result.error, "Unable to delete linked records. Please try again."));
}

async function syncRelationalTables() {
  if (!supabaseClient) return;
  const now = new Date().toISOString();
  const courseMasterRows = [...state.programs]
    .sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0))
    .map((program) => {
      const row = {
        id: program.id,
        parent_id: program.parentId || null,
        code: program.code || "",
        name: program.name,
        level: program.level || "",
        duration: program.duration || "",
        eligibility: program.eligibility || "",
        session_templates: program.sessionTemplates || [],
        ...(supportsCoursePricing ? { pricing_tiers: normalizePricingTiers(program.pricingTiers) } : {}),
        updated_at: now
      };
      if (supportsCourseTeacherIds) row.teacher_ids = program.teacherIds || [];
      return row;
    });
  if (!supportsCourseTeacherIds && state.programs.some((program) => (program.teacherIds || []).length)) {
    remoteStatus = "Supabase synced - run supabase/production_schema_update.sql";
  }
  if (!supportsBatchStatus && state.courses.length) {
    remoteStatus = "Supabase synced - run supabase/production_schema_update.sql";
  }
  if (!supportsNormalizedSessions && (state.programs.some((program) => (program.sessionTemplates || []).length) || state.courses.some((course) => (course.sessions || []).length))) {
    remoteStatus = "Supabase synced - run supabase/production_schema_update.sql";
  }
  if (!supportsTeacherProfileFields && state.teachers.some((teacher) => teacher.title || teacher.firstName || teacher.lastName || teacher.contactNumber || teacher.education || teacher.gender || teacher.maritalStatus)) {
    remoteStatus = "Supabase synced - run supabase/production_schema_update.sql";
  }
  if (!supportsRegistrationAccommodationType && allRegistrationRows().some(({ registration }) => normalizeAccommodationType(registration.accommodationType) !== "Not Required")) {
    remoteStatus = "Supabase synced - run supabase/production_schema_update.sql";
  }
  if (!supportsRegistrationStayDates && allRegistrationRows().some(({ registration }) => registration.checkinDate || registration.checkoutDate)) {
    remoteStatus = "Supabase synced - run supabase/production_schema_update.sql";
  }
  if (!supportsRoomOperations && state.rooms.some((room) => normalizeRoomStatus(room.status) !== "Clean" || room.cleaningNotes)) {
    remoteStatus = "Supabase synced - run supabase/production_schema_update.sql";
  }
  if (!supportsCoursePricing && state.programs.some((program) => normalizePricingTiers(program.pricingTiers).length)) {
    remoteStatus = "Supabase synced - run supabase/production_schema_update.sql";
  }
  if (!supportsRegistrationPayment && allRegistrationRows().some(({ registration }) => registration.pricingCategory || registration.amount || registration.paymentStatus)) {
    remoteStatus = "Supabase synced - run supabase/production_schema_update.sql";
  }
  const teacherRows = state.teachers.map((teacher) => ({
    id: teacher.id,
    name: teacher.name,
    speciality: teacher.speciality || "",
    phone: teacher.phone || "",
    email: teacher.email || "",
    photo: teacher.photo || "",
    notes: teacher.notes || "",
    updated_at: now
  })).map((row, index) => {
    if (!supportsTeacherProfileFields) return row;
    const teacher = state.teachers[index];
    return {
      ...row,
      title: teacher.title || "",
      first_name: teacher.firstName || "",
      last_name: teacher.lastName || "",
      contact_number: teacher.contactNumber || "",
      education: teacher.education || "",
      gender: teacher.gender || "",
      marital_status: teacher.maritalStatus || ""
    };
  });
  const hallRows = state.halls.map((hall) => ({
    id: hall.id,
    name: hall.name,
    capacity: Number(hall.capacity) || 1,
    location: hall.location || "",
    notes: hall.notes || "",
    updated_at: now
  }));
  const blockRows = state.blocks.map((block) => ({
    id: block.id,
    name: block.name,
    gender: "",
    notes: block.notes || "",
    updated_at: now
  }));
  const floorRows = state.floors.map((floor) => ({
    id: floor.id,
    block_id: floor.blockId || null,
    name: floor.name,
    updated_at: now
  }));
  const roomRows = state.rooms.map((room) => ({
    id: room.id,
    block_id: room.blockId || null,
    floor_id: room.floorId || null,
    name: room.name,
    gender: normalizeRoomType(room.gender),
    beds: Number(room.beds) || 1,
    updated_at: now
  })).map((row, index) => ({
    ...row,
    ...(supportsRoomOperations ? {
      status: normalizeRoomStatus(state.rooms[index].status),
      cleaning_notes: state.rooms[index].cleaningNotes || ""
    } : {})
  }));
  const batchRows = state.courses.map((course) => {
    const teacher = teacherByName(course.teacher);
    const persistedTeacher = teacher && !teacher.isVirtual && state.teachers.some((item) => item.id === teacher.id) ? teacher : null;
    const persistedProgramId = state.programs.some((program) => program.id === course.programId) ? course.programId : null;
    const persistedHallId = state.halls.some((hall) => hall.id === course.hallId) ? course.hallId : null;
    const row = {
      id: course.id,
      program_id: persistedProgramId,
      name: course.name,
      start_date: course.start,
      end_date: course.end,
      seats: Number(course.seats) || 1,
      hall_id: persistedHallId,
      teacher_id: persistedTeacher?.id || null,
      teacher_name: course.teacher || "",
      eligibility: course.eligibility || "",
      sessions: course.sessions || [],
      updated_at: now
    };
    if (supportsBatchStatus) row.status = course.status || programLifecycleStatus(course);
    return row;
  });
  const participantRows = state.participants.map((participant) => ({
    id: participant.id,
    name: participant.name,
    age: Number(participant.age) || null,
    gender: participant.gender || "",
    phone: participant.phone || "",
    email: participant.email || "",
    address: participant.address || "",
    emergency_contact: participant.emergencyContact || "",
    photo: participant.photo || "",
    notes: participant.notes || "",
    program_history: participant.programHistory || [],
    updated_at: now
  }));
  const registrationPairs = allRegistrationRows();
  const registrationRows = registrationPairs.map(({ participant, registration }) => ({
    id: registration.id,
    participant_id: participant.id,
    batch_id: registration.courseId || null,
    status: registration.status || "Pending",
    eligible: Boolean(registration.eligible),
    room_id: registration.roomId || null,
    checked_in: Boolean(registration.checkedIn),
    attendance: Number(registration.attendance) || 0,
    completion: registration.completion || "Pending",
    certificate: Boolean(registration.certificate),
    session_attendance: registration.sessionAttendance || [],
    notes: registration.notes || "",
    registered_on: registration.registeredOn || new Date().toISOString().slice(0, 10),
    updated_at: now
  })).map((row, index) => {
    const registration = registrationPairs[index].registration;
    return {
      ...row,
      ...(supportsRegistrationAccommodationType ? { accommodation_type: normalizeAccommodationType(registration.accommodationType) } : {}),
      ...(supportsRegistrationStayDates ? {
        checkin_date: stayDateRange(registration).start || null,
        checkout_date: stayDateRange(registration).end || null,
        checked_out: Boolean(registration.checkedOut)
      } : {}),
      ...(supportsRegistrationPayment ? {
        pricing_category: registration.pricingCategory || pricingTiersForCourse(registration.courseId)[0]?.category || "General",
        amount: Number(registration.amount) || priceForRegistration(registration.courseId, registration.pricingCategory),
        payment_status: normalizePaymentStatus(registration.paymentStatus)
      } : {})
    };
  });
  const hallBookingRows = state.hallBookings.map((booking) => ({
    id: booking.id,
    batch_id: booking.courseId || null,
    hall_id: booking.hallId || null,
    start_date: booking.start,
    end_date: booking.end,
    notes: booking.notes || "",
    updated_at: now
  }));
  const courseSessionTemplateRows = state.programs.flatMap((program) => (program.sessionTemplates || []).map((session, index) => ({
    id: session.id,
    program_id: program.id,
    day_number: Number(session.day) || 1,
    title: session.title || "",
    time: session.time || "",
    topic: session.topic || "",
    display_order: index + 1,
    updated_at: now
  })));
  const batchSessionRows = state.courses.flatMap((course) => courseSessionPlan(course.id).map((session, index) => ({
    id: session.id,
    batch_id: course.id,
    session_date: session.date,
    title: session.title || "",
    time: session.time || "",
    topic: session.topic || "",
    display_order: index + 1,
    updated_at: now
  })));
  const sessionAttendanceRows = allRegistrationRows().flatMap(({ participant, registration }) => (registration.sessionAttendance || []).map((record) => ({
    id: `${registration.id}-${record.sessionId}`.slice(0, 250),
    registration_id: registration.id,
    participant_id: participant.id,
    batch_id: registration.courseId || null,
    batch_session_id: record.sessionId,
    status: record.status || "Present",
    reason: record.reason || "",
    marked_at: now,
    updated_at: now
  })));

  await upsertSupabaseRows("course_masters", courseMasterRows);
  if (supportsNormalizedSessions) await upsertSupabaseRows("course_session_templates", courseSessionTemplateRows);
  await upsertSupabaseRows("teachers", teacherRows);
  await upsertSupabaseRows("program_halls", hallRows);
  await upsertSupabaseRows("accommodation_blocks", blockRows);
  await upsertSupabaseRows("accommodation_floors", floorRows);
  await upsertSupabaseRows("rooms", roomRows);
  await upsertSupabaseRows("batches", batchRows);
  if (supportsNormalizedSessions) await upsertSupabaseRows("batch_sessions", batchSessionRows);
  await upsertSupabaseRows("participants", participantRows);
  await upsertSupabaseRows("registrations", registrationRows);
  if (supportsNormalizedSessions) await upsertSupabaseRows("session_attendance", sessionAttendanceRows);
  await upsertSupabaseRows("hall_bookings", hallBookingRows);
}

function publicSession() {
  return {
    role: "public",
    id: "",
    userId: "",
    email: "",
    name: "Public Visitor",
    permissions: {
      canManageMasters: false,
      canReviewRegistrations: false,
      canMarkAttendance: false
    }
  };
}

function loadCachedSession() {
  return publicSession();
}

function cacheCurrentSession() {
  // Supabase Auth remains authoritative; app records are never cached in browser storage.
}

function migrateState() {
  Object.entries(emptyState()).forEach(([key, value]) => {
    if (!Array.isArray(state[key])) state[key] = value;
  });
  state.programs.forEach((program) => {
    program.name = program.name.replace("Residential Yoga Programs", "Residential Yoga Courses").replace("SKY & Kaya Kalpa Programs", "SKY & Kaya Kalpa Courses");
    program.eligibility = program.eligibility.replace("Open program family", "Open course family");
    if (program.parentId && !Array.isArray(program.sessionTemplates)) {
      program.sessionTemplates = [
        { id: `${program.id}-s1`, day: 1, title: "Morning Practice", time: "06:00-08:00", topic: `${program.name} practice` },
        { id: `${program.id}-s2`, day: 1, title: "Evening Satsang", time: "17:00-18:30", topic: `${program.name} review` }
      ];
    }
    if (!Array.isArray(program.teacherIds)) program.teacherIds = [];
  });
  state.hallBookings.forEach((booking) => {
    booking.notes = (booking.notes || "").replaceAll("batch", "program").replaceAll("Batch", "Program");
  });
  state.rooms.forEach((room) => {
    if (!room.blockId) {
      room.blockId = room.name.includes("Block A") ? "b1" : room.name.includes("Block B") ? "b2" : "b3";
    }
    if (!room.floorId) {
      room.floorId = room.blockId === "b1" ? "f1" : room.blockId === "b2" ? "f2" : "f3";
    }
  });
  state.courses.forEach((course) => {
    const hall = state.halls.find((item) => item.name === course.hall);
    if (hall) course.hallId ||= hall.id;
    if (!course.programId) {
      course.programId = courseMasterForBatch(course)?.id || "";
    }
    if (!Array.isArray(course.sessions)) {
      course.sessions = defaultSessionPlan(course.id);
    }
  });
  state.teachers.forEach((teacher) => {
    const splitName = splitTeacherName(teacher.name || "");
    teacher.title ||= "";
    teacher.firstName ||= splitName.firstName;
    teacher.lastName ||= splitName.lastName;
    teacher.name = teacherDisplayName(teacher);
    teacher.photo ||= "";
    teacher.contactNumber ||= "";
    teacher.education ||= "";
    teacher.gender ||= "";
    teacher.maritalStatus ||= "";
    teacher.notes = (teacher.notes || "").replaceAll("batches", "programs").replaceAll("Batches", "Programs");
  });
  state.participants.forEach((participant) => {
    participant.address ||= "";
    participant.emergencyContact ||= "";
    participant.photo ||= "";
    if (!Array.isArray(participant.programHistory)) {
      participant.programHistory = [];
    }
    if (!Array.isArray(participant.registrations)) {
      participant.registrations = [{
        id: `reg-${participant.id}-${participant.courseId || "unassigned"}`,
        courseId: participant.courseId,
        status: participant.status,
        eligible: participant.eligible,
        pricingCategory: participant.pricingCategory || "General",
        amount: Number(participant.amount) || 0,
        paymentStatus: normalizePaymentStatus(participant.paymentStatus),
        accommodationType: normalizeAccommodationType(participant.accommodationType),
        roomId: participant.roomId,
        checkedIn: participant.checkedIn,
        checkedOut: Boolean(participant.checkedOut),
        checkinDate: participant.checkinDate || "",
        checkoutDate: participant.checkoutDate || "",
        attendance: participant.attendance,
        completion: participant.completion,
        certificate: participant.certificate,
        sessionAttendance: legacySessionAttendance(participant.courseId, participant.attendance, participant.completion),
        notes: participant.notes || "",
        registeredOn: "2026-06-01"
      }];
    }
    participant.registrations.forEach((registration) => {
      if (!Array.isArray(registration.sessionAttendance)) {
        registration.sessionAttendance = legacySessionAttendance(registration.courseId, registration.attendance, registration.completion);
      }
      const validSessionIds = courseSessionPlan(registration.courseId).map((session) => session.id);
      if (registration.sessionAttendance.length && registration.sessionAttendance.some((record) => !validSessionIds.includes(record.sessionId))) {
        registration.sessionAttendance = legacySessionAttendance(registration.courseId, registration.attendance, registration.completion);
      }
      updateRegistrationCompletion(registration);
    });
  });
  const participantsByIdentity = [];
  state.participants.forEach((participant) => {
    const identity = participantIdentity(participant);
    const existing = participantsByIdentity.find(({ participant: candidate, identity: candidateIdentity }) => {
      return (identity.phone && candidateIdentity.phone === identity.phone)
        || (identity.email && candidateIdentity.email === identity.email)
        || candidate.id === participant.id;
    })?.participant;
    if (!existing) {
      participantsByIdentity.push({ participant, identity });
      return;
    }
    existing.registrations = [...registrationsForParticipant(existing), ...registrationsForParticipant(participant)];
    existing.programHistory = [...(existing.programHistory || []), ...(participant.programHistory || [])];
    existing.notes = [existing.notes, participant.notes].filter(Boolean).join(" | ");
    if (!existing.photo && participant.photo) existing.photo = participant.photo;
    if (!existing.address && participant.address) existing.address = participant.address;
    if (!existing.emergencyContact && participant.emergencyContact) existing.emergencyContact = participant.emergencyContact;
    syncParticipantFromRegistration(existing, currentRegistration(existing));
  });
  state.participants = participantsByIdentity.map((entry) => entry.participant);
}

function saveData() {
  if (isHydratingRemoteData) return;
  scheduleRemoteSave();
}

function courseName(id) {
  return state.courses.find((course) => course.id === id)?.name || "Unassigned";
}

function batchForParticipant(participant) {
  return state.courses.find((course) => course.id === currentRegistration(participant)?.courseId) || null;
}

function courseMasterForBatch(batch) {
  if (!batch) return null;
  const batchName = batch.name.toLowerCase();
  return state.programs.find((program) => program.parentId && batchName.includes(program.name.toLowerCase()))
    || state.programs.find((program) => program.parentId && program.eligibility === batch.eligibility)
    || null;
}

function roomName(id) {
  return state.rooms.find((room) => room.id === id)?.name || "Not assigned";
}

function blockName(id) {
  return state.blocks.find((block) => block.id === id)?.name || "No block";
}

function floorName(id) {
  return state.floors.find((floor) => floor.id === id)?.name || "No floor";
}

function hallName(id) {
  return state.halls.find((hall) => hall.id === id)?.name || "No hall";
}

function normalizeRoomType(value) {
  return roomTypes.includes(value) ? value : "Dormitory";
}

function normalizeAccommodationType(value) {
  return accommodationTypes.includes(value) ? value : "Not Required";
}

function normalizeRoomStatus(value) {
  return roomStatuses.includes(value) ? value : "Clean";
}

function normalizePaymentStatus(value) {
  return paymentStatuses.includes(value) ? value : "Enquiry";
}

function normalizeEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function normalizePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function participantIdentity(participant = {}) {
  return {
    phone: normalizePhone(participant.phone || participant.id),
    email: normalizeEmail(participant.email)
  };
}

function findParticipantByIdentity(details = {}) {
  const phone = normalizePhone(details.phone || details.id);
  const email = normalizeEmail(details.email);
  const participantId = details.participantId || details.id || "";
  return state.participants.find((participant) => {
    const identity = participantIdentity(participant);
    return (participantId && participant.id === participantId)
      || (phone && identity.phone === phone)
      || (email && identity.email === email);
  }) || null;
}

function normalizePricingTiers(value) {
  const tiers = Array.isArray(value) ? value : [];
  const normalized = tiers.map((tier) => ({
    category: String(tier.category || tier.name || "").trim(),
    amount: Number(tier.amount ?? tier.price ?? 0) || 0
  })).filter((tier) => tier.category);
  return normalized.length ? normalized : [...defaultPricingTiers];
}

function pricingTiersText(tiers) {
  return normalizePricingTiers(tiers).map((tier) => `${tier.category} - ${tier.amount}`).join("\n");
}

function parsePricingTiers(text) {
  const rows = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const tiers = rows.map((line) => {
    const match = line.match(/^(.+?)(?:\s*[-:]\s*|\s+)(\d+(?:\.\d+)?)$/);
    return match ? { category: match[1].trim(), amount: Number(match[2]) || 0 } : null;
  }).filter(Boolean);
  return normalizePricingTiers(tiers);
}

function courseMasterForProgram(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  return state.programs.find((program) => program.id === course?.programId) || null;
}

function pricingTiersForCourse(courseId) {
  return normalizePricingTiers(courseMasterForProgram(courseId)?.pricingTiers);
}

function priceForRegistration(courseId, category) {
  const tiers = pricingTiersForCourse(courseId);
  return tiers.find((tier) => tier.category === category)?.amount ?? tiers[0]?.amount ?? 0;
}

function isRefresherCategory(category = "") {
  return String(category || "").trim().toLowerCase() === "refresher";
}

function hasCompletedCourseMasterBefore(participant, courseId, excludeRegistrationId = "") {
  if (!participant) return false;
  const targetMasterId = courseMasterForProgram(courseId)?.id || "";
  return registrationsForParticipant(participant).some((registration) => {
    if (registration.id === excludeRegistrationId || registration.courseId === courseId) return false;
    if (registration.completion !== "Completed") return false;
    const registrationMasterId = courseMasterForProgram(registration.courseId)?.id || "";
    return targetMasterId ? registrationMasterId === targetMasterId : registration.courseId === courseId;
  });
}

function requiresRefresherCompletionVerification(participant, registration) {
  return isRefresherCategory(registration?.pricingCategory) && !hasCompletedCourseMasterBefore(participant, registration.courseId, registration.id);
}

function canApproveRegistration(participant, registration) {
  if (!requiresRefresherCompletionVerification(participant, registration)) return true;
  showToast("Refresher registration needs a completed earlier program for this course before confirmation.");
  return false;
}

function paidOrApprovedRegistrationsForCourse(courseId, excludeRegistrationId = "") {
  return allRegistrationRows().filter(({ registration }) => registration.id !== excludeRegistrationId && registration.courseId === courseId && !["Cancelled", "Dropout"].includes(registration.status) && ["Paid", "Approved"].includes(normalizePaymentStatus(registration.paymentStatus)));
}

function seatStatusForRegistration(courseId, paymentStatus, excludeRegistrationId = "") {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return "Pending";
  if (!["Paid", "Approved"].includes(normalizePaymentStatus(paymentStatus))) return "Pending";
  return paidOrApprovedRegistrationsForCourse(courseId, excludeRegistrationId).length < Number(course.seats) ? "Confirmed" : "Waitlist";
}

function promoteWaitlistForCourse(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course || paidOrApprovedRegistrationsForCourse(courseId).length >= Number(course.seats)) return null;
  const next = allRegistrationRows()
    .filter(({ registration }) => registration.courseId === courseId && registration.status === "Waitlist" && ["Paid", "Approved"].includes(normalizePaymentStatus(registration.paymentStatus)))
    .sort((a, b) => (a.registration.registeredOn || "").localeCompare(b.registration.registeredOn || ""))[0];
  if (!next) return null;
  next.registration.status = "Confirmed";
  if (next.registration === currentRegistration(next.participant)) syncParticipantFromRegistration(next.participant, next.registration);
  return next.participant.name;
}

function reRegistrationReason(registration) {
  if (registration.status === "Waitlist") return "Waitlist";
  if (registration.status === "Cancelled") return "Cancellation";
  if (registration.status === "Dropout" || registration.completion === "Dropout") return "Dropout";
  return "";
}

function reRegistrationCandidatesForCourse(course) {
  if (!course) return [];
  const seenParticipants = new Set();
  return allRegistrationRows()
    .filter(({ participant, registration }) => {
      const sourceCourse = state.courses.find((item) => item.id === registration.courseId);
      if (!sourceCourse || sourceCourse.id === course.id) return false;
      if (sourceCourse.programId !== course.programId) return false;
      if (sourceCourse.start && course.start && sourceCourse.start > course.start) return false;
      if (registrationsForParticipant(participant).some((item) => item.courseId === course.id)) return false;
      return Boolean(reRegistrationReason(registration));
    })
    .sort((a, b) => {
      const priority = { Waitlist: 0, Cancellation: 1, Dropout: 2 };
      return (priority[reRegistrationReason(a.registration)] ?? 9) - (priority[reRegistrationReason(b.registration)] ?? 9)
        || (a.registration.registeredOn || "").localeCompare(b.registration.registeredOn || "");
    })
    .filter(({ participant }) => {
      if (seenParticipants.has(participant.id)) return false;
      seenParticipants.add(participant.id);
      return true;
    });
}

function seedReRegistrationsForCourse(course) {
  const candidates = reRegistrationCandidatesForCourse(course);
  candidates.forEach(({ participant, registration: sourceRegistration }) => {
    const reason = reRegistrationReason(sourceRegistration);
    const paymentStatus = ["Paid", "Approved"].includes(normalizePaymentStatus(sourceRegistration.paymentStatus)) ? sourceRegistration.paymentStatus : "Payment Pending";
    const registration = registrationPayloadForCourse(
      course.id,
      `Auto re-registration from ${reason} in ${courseName(sourceRegistration.courseId)}.`,
      sourceRegistration.accommodationType || "Not Required",
      sourceRegistration.pricingCategory || "",
      paymentStatus
    );
    registration.eligible = normalizePaymentStatus(paymentStatus) === "Approved";
    registrationsForParticipant(participant).push(registration);
    if (registration === currentRegistration(participant)) syncParticipantFromRegistration(participant, registration);
  });
  return candidates.length;
}

function roomTypeOptions(selected = "") {
  const normalized = normalizeRoomType(selected);
  return roomTypes.map((type) => ({ value: type, label: type, selected: type === normalized }));
}

function roomStatusOptions(selected = "Clean") {
  const normalized = normalizeRoomStatus(selected);
  return roomStatuses.map((status) => ({ value: status, label: status, selected: status === normalized }));
}

function roomForParticipant(participant) {
  return state.rooms.find((room) => room.id === currentRegistration(participant)?.roomId) || null;
}

function roomOccupancyForProgram(roomId, courseId) {
  return allRegistrationRows().filter(({ registration }) => registration.courseId === courseId && registration.roomId === roomId && registration.status === "Confirmed").length;
}

function roomsForAccommodationType(type) {
  const normalized = normalizeAccommodationType(type);
  if (normalized === "Not Required") return [];
  return state.rooms.filter((room) => normalizeRoomType(room.gender) === normalized);
}

function isRoomClean(room) {
  return normalizeRoomStatus(room?.status) === "Clean";
}

function courseForRegistration(registration) {
  return state.courses.find((course) => course.id === registration.courseId) || null;
}

function stayDateRange(registration) {
  const course = courseForRegistration(registration);
  return {
    start: registration.checkinDate || course?.start || "",
    end: registration.checkoutDate || course?.end || registration.checkinDate || course?.start || ""
  };
}

function dateRangesOverlap(firstStart, firstEnd, secondStart, secondEnd) {
  if (!firstStart || !firstEnd || !secondStart || !secondEnd) return false;
  const firstStartDate = dateFromInput(firstStart);
  const firstEndDate = dateFromInput(firstEnd);
  const secondStartDate = dateFromInput(secondStart);
  const secondEndDate = dateFromInput(secondEnd);
  if (!firstStartDate || !firstEndDate || !secondStartDate || !secondEndDate) return false;
  return firstStartDate <= secondEndDate && secondStartDate <= firstEndDate;
}

function overlappingRoomRegistrations(roomId, startDate, endDate, excludeRegistrationId = "") {
  return allRegistrationRows().filter(({ registration }) => {
    if (registration.id === excludeRegistrationId) return false;
    if (registration.status !== "Confirmed" || registration.roomId !== roomId) return false;
    if (registration.checkedOut) return false;
    const stay = stayDateRange(registration);
    return dateRangesOverlap(startDate, endDate, stay.start, stay.end);
  });
}

function roomOccupancyForDateRange(roomId, startDate, endDate, excludeRegistrationId = "") {
  return overlappingRoomRegistrations(roomId, startDate, endDate, excludeRegistrationId).length;
}

function availableBedsForDateRange(room, startDate, endDate, excludeRegistrationId = "") {
  if (!isRoomClean(room)) return 0;
  return Math.max(0, Number(room.beds) - roomOccupancyForDateRange(room.id, startDate, endDate, excludeRegistrationId));
}

function totalAvailableBedsForDateRange(startDate, endDate) {
  return state.rooms.reduce((sum, room) => sum + availableBedsForDateRange(room, startDate, endDate), 0);
}

function registrationsForParticipant(participant) {
  return Array.isArray(participant.registrations) && participant.registrations.length
    ? participant.registrations
    : [{
      id: `reg-${participant.id}-${participant.courseId || "unassigned"}`,
      courseId: participant.courseId,
      status: participant.status,
      eligible: participant.eligible,
      pricingCategory: participant.pricingCategory || "General",
      amount: Number(participant.amount) || 0,
      paymentStatus: normalizePaymentStatus(participant.paymentStatus),
      accommodationType: normalizeAccommodationType(participant.accommodationType),
      roomId: participant.roomId,
      checkedIn: participant.checkedIn,
      checkedOut: Boolean(participant.checkedOut),
      checkinDate: participant.checkinDate || "",
      checkoutDate: participant.checkoutDate || "",
      attendance: participant.attendance,
      completion: participant.completion,
      certificate: participant.certificate,
      notes: participant.notes || "",
      registeredOn: "2026-06-01"
    }];
}

function currentRegistration(participant) {
  const registrations = registrationsForParticipant(participant);
  return registrations[registrations.length - 1] || null;
}

function syncParticipantFromRegistration(participant, registration) {
  participant.courseId = registration.courseId;
  participant.status = registration.status;
  participant.eligible = registration.eligible;
  participant.pricingCategory = registration.pricingCategory || "General";
  participant.amount = Number(registration.amount) || 0;
  participant.paymentStatus = normalizePaymentStatus(registration.paymentStatus);
  participant.accommodationType = normalizeAccommodationType(registration.accommodationType);
  participant.roomId = registration.roomId;
  participant.checkedIn = registration.checkedIn;
  participant.checkedOut = Boolean(registration.checkedOut);
  participant.checkinDate = registration.checkinDate || "";
  participant.checkoutDate = registration.checkoutDate || "";
  participant.attendance = registration.attendance;
  participant.completion = registration.completion;
  participant.certificate = registration.certificate;
  participant.notes = registration.notes || participant.notes || "";
}

function allRegistrationRows() {
  return state.participants.flatMap((participant) => registrationsForParticipant(participant).map((registration) => ({
    participant,
    registration
  })));
}

function teacherByName(name) {
  return assignableTeachers().find((teacher) => teacherDisplayName(teacher) === name || teacher.name === name) || null;
}

function teacherById(teacherId) {
  return state.teachers.find((teacher) => teacher.id === teacherId) || null;
}

function assignableTeachers() {
  const teachers = new Map(state.teachers.map((teacher) => [teacher.id, teacher]));
  accessUsers
    .filter((user) => user.active !== false && isTeacherRole(user.role_id))
    .forEach((user) => {
      const linkedTeacher = teacherById(user.linked_teacher_id);
      if (linkedTeacher) {
        teachers.set(linkedTeacher.id, linkedTeacher);
        return;
      }
      const virtualId = user.linked_teacher_id || user.user_id;
      const existingTeacher = teacherById(virtualId);
      if (existingTeacher) {
        teachers.set(existingTeacher.id, existingTeacher);
        return;
      }
      const splitName = splitTeacherName(user.display_name || user.login_email || "Teacher");
      teachers.set(virtualId, {
        id: virtualId,
        title: "",
        firstName: splitName.firstName,
        lastName: splitName.lastName,
        name: user.display_name || user.login_email || "Teacher",
        speciality: roleById(user.role_id)?.name || "Faculty",
        phone: "",
        email: user.login_email || "",
        photo: "",
        contactNumber: "",
        education: "",
        gender: "",
        maritalStatus: "",
        notes: "Teacher login user",
        isVirtual: true
      });
    });
  return Array.from(teachers.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function teacherNameById(teacherId) {
  const teacher = assignableTeachers().find((teacher) => teacher.id === teacherId);
  return teacher ? teacherDisplayName(teacher) : "";
}

function mappedTeachersForProgram(programId) {
  const program = state.programs.find((item) => item.id === programId);
  if (!program) return [];
  const ids = Array.isArray(program.teacherIds) ? program.teacherIds : [];
  const teachers = assignableTeachers();
  return ids.map((teacherId) => teachers.find((teacher) => teacher.id === teacherId)).filter(Boolean);
}

function teachersForProgram(programId) {
  return mappedTeachersForProgram(programId).length ? mappedTeachersForProgram(programId) : assignableTeachers();
}

function courseMasterLabel(program) {
  const ancestors = programAncestors(program).map((item) => item.name);
  return [...ancestors, program.name].join(" > ");
}

function courseDays(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return [];
  const [startYear, startMonth, startDay] = course.start.split("-").map(Number);
  const [endYear, endMonth, endDay] = course.end.split("-").map(Number);
  const start = new Date(startYear, startMonth - 1, startDay);
  const end = new Date(endYear, endMonth - 1, endDay);
  const days = [];
  for (let day = new Date(start); day <= end; day.setDate(day.getDate() + 1)) {
    const year = day.getFullYear();
    const month = String(day.getMonth() + 1).padStart(2, "0");
    const date = String(day.getDate()).padStart(2, "0");
    days.push(`${year}-${month}-${date}`);
  }
  return days;
}

function defaultSessionPlan(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  const template = state.programs.find((program) => program.id === course?.programId)?.sessionTemplates || [];
  if (course?.programId && !template.length) {
    return [];
  }
  if (course && template.length) {
    const [startYear, startMonth, startDay] = course.start.split("-").map(Number);
    return template.map((item) => {
      const day = new Date(startYear, startMonth - 1, startDay);
      day.setDate(day.getDate() + Number(item.day || 1) - 1);
      const year = day.getFullYear();
      const month = String(day.getMonth() + 1).padStart(2, "0");
      const date = String(day.getDate()).padStart(2, "0");
      const sessionDate = `${year}-${month}-${date}`;
      return { id: `${courseId}-${item.id}`, date: sessionDate, title: item.title, time: item.time, topic: item.topic };
    });
  }
  return courseDays(courseId).flatMap((date, index) => [
    { id: `${courseId}-${date}-morning`, date, title: "Morning Practice", time: "06:00-08:00", topic: `Day ${index + 1} practice` },
    { id: `${courseId}-${date}-evening`, date, title: "Evening Satsang", time: "17:00-18:30", topic: `Day ${index + 1} review` }
  ]);
}

function courseSessionPlan(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return [];
  if (!Array.isArray(course.sessions) || course.sessions.length === 0) {
    course.sessions = defaultSessionPlan(courseId);
  }
  return course.sessions;
}

function legacySessionAttendance(courseId, attendanceCount, completion) {
  const sessions = courseSessionPlan(courseId);
  const presentCount = completion === "Completed" ? sessions.length : Math.min(attendanceCount || 0, sessions.length);
  return sessions.slice(0, presentCount).map((session) => ({ sessionId: session.id, status: "Present", reason: "" }));
}

function attendanceForSession(registration, sessionId) {
  return (registration.sessionAttendance || []).find((item) => item.sessionId === sessionId) || null;
}

function hasEarlierSessionAbsence(registration, sessionId) {
  const sessions = courseSessionPlan(registration.courseId);
  const index = sessions.findIndex((session) => session.id === sessionId);
  return (registration.sessionAttendance || []).some((item) => {
    const recordIndex = sessions.findIndex((session) => session.id === item.sessionId);
    return item.status === "Absent" && recordIndex >= 0 && recordIndex < index;
  });
}

function updateRegistrationCompletion(registration) {
  const sessions = courseSessionPlan(registration.courseId);
  registration.attendance = (registration.sessionAttendance || []).filter((item) => item.status === "Present" || item.status === "Late").length;
  const hasFullAttendance = sessions.length > 0 && sessions.every((session) => {
    const record = attendanceForSession(registration, session.id);
    return record?.status === "Present" || record?.status === "Late";
  });
  if (hasFullAttendance) registration.completion = "Completed";
  if ((registration.sessionAttendance || []).some((item) => item.status === "Absent")) registration.completion = "In Progress";
}

function registrationRowsForCourse(courseId) {
  return allRegistrationRows().filter(({ registration }) => registration.courseId === courseId && registration.status === "Confirmed");
}

function teacherPhoto(teacher) {
  if (teacher.photo) return teacher.photo;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="180" viewBox="0 0 160 180"><rect width="160" height="180" rx="18" fill="#dff3ef"/><circle cx="80" cy="62" r="34" fill="#0f766e" opacity=".9"/><path d="M30 154c8-36 30-55 50-55s42 19 50 55" fill="#115e59" opacity=".72"/><text x="80" y="70" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="white">${initials(teacherDisplayName(teacher))}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function splitTeacherName(name = "") {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" ")
  };
}

function teacherDisplayName(teacher) {
  return [teacher.title, teacher.firstName, teacher.lastName].filter(Boolean).join(" ").trim() || teacher.name || "Teacher";
}

function initials(name) {
  return name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function participantPhoto(participant) {
  if (participant.photo) return participant.photo;
  const palette = participant.gender === "Male" ? ["#dbeafe", "#1d4ed8"] : participant.gender === "Female" ? ["#fce7f3", "#be185d"] : ["#ede9fe", "#6d28d9"];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="180" viewBox="0 0 160 180"><rect width="160" height="180" rx="18" fill="${palette[0]}"/><circle cx="80" cy="62" r="34" fill="${palette[1]}" opacity=".9"/><path d="M30 154c8-36 30-55 50-55s42 19 50 55" fill="${palette[1]}" opacity=".72"/><text x="80" y="70" text-anchor="middle" font-family="Arial, sans-serif" font-size="26" font-weight="700" fill="white">${initials(participant.name)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function allowedViews() {
  if (roleViews[currentSession.role]) return roleViews[currentSession.role];
  if (currentSession.permissions?.canManageMasters) return roleViews.admin;
  if (currentSession.permissions?.canMarkAttendance) return roleViews.teacher;
  return roleViews.participant;
}

function defaultViewForRole(role = currentSession.role) {
  if (role === currentSession.role) return allowedViews()[0] || "portal";
  return (roleViews[role] || roleViews.public)[0] || "portal";
}

function canAccessView(viewId) {
  return allowedViews().includes(viewId);
}

function isAdmin() {
  return currentSession.role === "admin";
}

function canManageMasters() {
  return currentSession.role === "admin" || Boolean(currentSession.permissions?.canManageMasters);
}

function canReviewRegistrations() {
  return currentSession.role === "admin" || Boolean(currentSession.permissions?.canReviewRegistrations);
}

function canMarkAttendance() {
  return currentSession.role === "admin" || currentSession.role === "teacher" || Boolean(currentSession.permissions?.canMarkAttendance);
}

function currentParticipant() {
  if (currentSession.role !== "participant") return null;
  return state.participants.find((participant) => participant.id === currentSession.id) || null;
}

function currentTeacher() {
  if (currentSession.role !== "teacher") return null;
  return assignableTeachers().find((teacher) => teacher.id === currentSession.id || teacher.email === currentSession.email) || null;
}

function courseAssignedToCurrentTeacher(course) {
  const teacher = currentTeacher();
  if (!teacher) return false;
  const displayName = teacherDisplayName(teacher);
  return course.teacher === displayName || course.teacher === teacher.name || mappedTeachersForProgram(course.programId).some((item) => item.id === teacher.id);
}

function visibleCourses() {
  if (currentSession.role === "teacher") return state.courses.filter(courseAssignedToCurrentTeacher);
  if (currentSession.role === "participant") {
    const participant = currentParticipant();
    if (!participant) return [];
    const courseIds = new Set(registrationsForParticipant(participant).map((registration) => registration.courseId).filter(Boolean));
    return state.courses.filter((course) => courseIds.has(course.id) || isPortalProgram(course));
  }
  return state.courses;
}

function canEditParticipant(participantId) {
  return canManageMasters() || (currentSession.role === "participant" && currentSession.id === participantId);
}

function canEditTeacher(teacherId) {
  return canManageMasters() || (currentSession.role === "teacher" && currentTeacher()?.id === teacherId);
}

function registrationPayloadForCourse(courseId, notes = "", accommodationType = "Not Required", pricingCategory = "", paymentStatus = "Enquiry", participant = null) {
  const course = state.courses.find((item) => item.id === courseId);
  const tiers = pricingTiersForCourse(courseId);
  const selectedCategory = pricingCategory || tiers[0]?.category || "General";
  const normalizedPaymentStatus = normalizePaymentStatus(paymentStatus);
  const refresherNeedsVerification = isRefresherCategory(selectedCategory) && !hasCompletedCourseMasterBefore(participant, courseId);
  const status = refresherNeedsVerification ? "Pending" : seatStatusForRegistration(courseId, normalizedPaymentStatus);
  return {
    id: newId("registration"),
    courseId,
    status,
    eligible: normalizedPaymentStatus === "Approved" && !refresherNeedsVerification,
    pricingCategory: selectedCategory,
    amount: priceForRegistration(courseId, selectedCategory),
    paymentStatus: normalizedPaymentStatus,
    accommodationType: normalizeAccommodationType(accommodationType),
    roomId: "",
    checkedIn: false,
    checkedOut: false,
    checkinDate: course?.start || "",
    checkoutDate: course?.end || "",
    attendance: 0,
    completion: "Pending",
    certificate: false,
    sessionAttendance: [],
    notes: [notes, refresherNeedsVerification ? "Refresher completion pending verification." : ""].filter(Boolean).join(" | "),
    registeredOn: new Date().toISOString().slice(0, 10)
  };
}

function registerParticipantForCourse(details, courseId) {
  const phone = String(details.phone || "").trim();
  const email = String(details.email || "").trim();
  let participant = findParticipantByIdentity({
    participantId: details.participantId,
    phone,
    email
  });
  const registration = registrationPayloadForCourse(courseId, details.notes || "", details.accommodationType || "Not Required", details.pricingCategory || "", details.paymentStatus || "Enquiry", participant);
  if (participant) {
    participant.name = String(details.name || "").trim() || participant.name;
    participant.age = Number(details.age) || participant.age;
    participant.gender = details.gender || participant.gender;
    if (!participant.phone || normalizePhone(participant.phone) === normalizePhone(phone)) participant.phone = phone || participant.phone;
    participant.email = email || participant.email;
    participant.photo = (details.photo || "").trim() || participant.photo || "";
    participant.address = (details.address || "").trim() || participant.address || "";
    participant.emergencyContact = (details.emergencyContact || "").trim() || participant.emergencyContact || "";
    participant.notes = details.notes || participant.notes || "";
    const existingRegistration = registrationsForParticipant(participant).find((item) => item.courseId === courseId && !["Cancelled", "Dropout"].includes(item.status));
    if (existingRegistration) {
      existingRegistration.pricingCategory = registration.pricingCategory;
      existingRegistration.amount = registration.amount;
      existingRegistration.paymentStatus = registration.paymentStatus;
      existingRegistration.status = registration.status;
      existingRegistration.eligible = registration.eligible;
      existingRegistration.accommodationType = registration.accommodationType;
      existingRegistration.checkinDate ||= registration.checkinDate;
      existingRegistration.checkoutDate ||= registration.checkoutDate;
      existingRegistration.notes = [existingRegistration.notes, registration.notes].filter(Boolean).join(" | ");
      syncParticipantFromRegistration(participant, existingRegistration);
    } else {
      registrationsForParticipant(participant).push(registration);
      syncParticipantFromRegistration(participant, registration);
    }
    return participant;
  }
  participant = {
    id: newId("participant"),
    name: details.name.trim(),
    age: Number(details.age),
    gender: details.gender,
    courseId,
    phone,
    email,
    photo: (details.photo || "").trim(),
    address: (details.address || "").trim(),
    emergencyContact: (details.emergencyContact || "").trim(),
    status: registration.status,
    eligible: registration.eligible,
    roomId: registration.roomId,
    checkedIn: registration.checkedIn,
    attendance: registration.attendance,
    completion: registration.completion,
    certificate: registration.certificate,
    programHistory: [],
    notes: details.notes || "",
    registrations: [registration]
  };
  state.participants.push(participant);
  return participant;
}

function visibleParticipants() {
  const participant = currentParticipant();
  if (participant) return [participant];
  if (currentSession.role === "teacher") {
    const ids = new Set(visibleRegistrationRows().map(({ participant }) => participant.id));
    return state.participants.filter((item) => ids.has(item.id));
  }
  return state.participants;
}

function visibleRegistrationRows() {
  const participant = currentParticipant();
  if (participant) {
    return registrationsForParticipant(participant).map((registration) => ({ participant, registration }));
  }
  if (currentSession.role === "teacher") {
    const visibleCourseIds = new Set(visibleCourses().map((course) => course.id));
    return allRegistrationRows().filter(({ registration }) => visibleCourseIds.has(registration.courseId));
  }
  return allRegistrationRows();
}

function roleById(roleId) {
  return accessRoles.find((role) => role.id === roleId) || null;
}

function isTeacherRole(roleId) {
  const role = roleById(roleId);
  const roleText = `${roleId || ""} ${role?.id || ""} ${role?.name || ""}`.toLowerCase();
  return roleText.includes("teacher");
}

function permissionsForRole(role) {
  if (!role) return [];
  return [
    role.can_manage_masters ? "Masters" : "",
    role.can_review_registrations ? "Registrations" : "",
    role.can_mark_attendance ? "Attendance" : ""
  ].filter(Boolean);
}

async function login(identifier, password) {
  if (!supabaseClient) {
    showToast("Supabase is not configured. Login requires Supabase Auth.");
    return;
  }
  if (!hasLoadedRemoteData) {
    showToast("Supabase data is still loading. Please try again in a moment.");
    return;
  }
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email: identifier.trim(),
    password
  });
  if (error || !data.user) {
    showToast("Invalid username or password.");
    return;
  }
  const hasRole = await applyAuthUserSession(data.user, { showError: true });
  if (!hasRole) {
    await supabaseClient.auth.signOut();
    return;
  }
  await loadAccessManagementData();
  selectedParticipantId = currentSession.role === "participant" ? currentSession.id : selectedParticipantId;
  selectedTeacherId = currentSession.role === "teacher" ? currentSession.id : selectedTeacherId;
  linkBackStack = [];
  renderNav();
  renderAll();
  activateView(defaultViewForRole(currentSession.role));
  showToast(`Logged in as ${currentSession.name}.`);
}

async function requestPasswordReset(identifier) {
  if (!supabaseClient) {
    showToast("Password reset requires Supabase Auth.");
    return;
  }
  const { error } = await supabaseClient.auth.resetPasswordForEmail(identifier.trim());
  if (error) {
    showToast(friendlyErrorMessage(error, "Unable to send password reset. Please check the email address and try again."));
    return;
  }
  showToast("Password reset email sent.");
}

async function logout() {
  if (supabaseClient) await supabaseClient.auth.signOut();
  currentSession = publicSession();
  cacheCurrentSession();
  linkBackStack = [];
  renderNav();
  renderAll();
  activateView("portal");
  showToast("Logged out.");
}

function participantProgramHistory(participant) {
  const registrationRecords = registrationsForParticipant(participant).map((registration) => {
    const batch = state.courses.find((course) => course.id === registration.courseId) || null;
    const courseMaster = courseMasterForBatch(batch);
    const room = state.rooms.find((item) => item.id === registration.roomId) || null;
    const stay = stayDateRange(registration);
    return {
      programName: courseMaster?.name || "Not mapped",
      batchName: batch?.name || "Unassigned",
      courseId: registration.courseId,
      start: batch?.start || "",
      end: batch?.end || "",
      status: registration.status,
      eligible: registration.eligible,
      paymentStatus: normalizePaymentStatus(registration.paymentStatus),
      pricingCategory: registration.pricingCategory || "General",
      amount: Number(registration.amount) || 0,
      completion: registration.completion,
      attendance: registration.attendance,
      certificate: registration.certificate,
      accommodationType: normalizeAccommodationType(registration.accommodationType),
      accommodation: roomName(registration.roomId),
      roomType: room?.gender || "",
      stayStart: stay.start,
      stayEnd: stay.end,
      stayStatus: registration.checkedOut ? "Checked out" : registration.checkedIn ? "Checked in" : "Not checked in",
      notes: registration.notes || ""
    };
  });
  return [...(participant.programHistory || []), ...registrationRecords];
}

function statusClass(value) {
  return value.toLowerCase().replace(/\s+/g, "-");
}

function getInitialCalendarDate() {
  const firstCourse = state.courses
    .map((course) => new Date(`${course.start}T00:00:00`))
    .sort((a, b) => a - b)[0];
  return firstCourse || new Date();
}

function formatMonthTitle(date) {
  return date.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

function isSameDate(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isDateInRange(date, start, end) {
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return day >= start.getTime() && day <= end.getTime();
}

function startOfToday() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function dateFromInput(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function programLifecycleStatus(course) {
  const start = dateFromInput(course.start);
  const end = dateFromInput(course.end);
  const today = startOfToday();
  if (end && end < today) return "Completed";
  if (start && start > today) return "Upcoming";
  return "Active";
}

function applyProgramLifecycleStatuses() {
  let changed = false;
  state.courses.forEach((course) => {
    const status = programLifecycleStatus(course);
    if (course.status !== status) {
      course.status = status;
      changed = true;
    }
  });
  return changed;
}

function isPortalProgram(course) {
  return programLifecycleStatus(course) === "Upcoming";
}

function isRegistrationProgram(course) {
  return programLifecycleStatus(course) !== "Completed";
}

function friendlyErrorMessage(error, fallback = "Unable to complete this action. Please try again.") {
  const rawMessage = String(error?.message || error || "").trim();
  const message = rawMessage.toLowerCase();
  if (!rawMessage) return fallback;
  console.warn("Supabase operation failed:", error);
  if (message.includes("failed to fetch") || message.includes("network") || message.includes("timeout")) {
    return "Unable to reach Supabase. Please check the internet connection and try again.";
  }
  if (message.includes("jwt") || message.includes("token") || message.includes("session")) {
    return "Your login session has expired. Please log in again.";
  }
  if (message.includes("row level security") || message.includes("violates row-level security") || message.includes("rls")) {
    return "You do not have permission to save this record. Please contact the admin.";
  }
  if (message.includes("duplicate key") || message.includes("unique constraint") || message.includes("already registered")) {
    return "A matching record already exists. Please open the existing record and update it.";
  }
  if (message.includes("foreign key") || message.includes("violates foreign key")) {
    return "This record is linked to another missing or deleted record. Please refresh and select a valid record.";
  }
  if (message.includes("not-null") || message.includes("null value")) {
    return "Some required information is missing. Please complete the required fields and try again.";
  }
  if (message.includes("invalid input syntax") || message.includes("invalid") || message.includes("malformed")) {
    return "One of the values entered is not in the expected format. Please review the form.";
  }
  if (message.includes("relation") && message.includes("does not exist")) {
    return "A required Supabase table is missing. Please run the latest production schema script.";
  }
  if (message.includes("column") && message.includes("does not exist")) {
    return "The Supabase schema is not up to date. Please run the latest production schema script.";
  }
  if (message.includes("permission denied") || message.includes("not authorized") || message.includes("unauthorized")) {
    return "You are not authorized to perform this action.";
  }
  return fallback;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function tableConfig(key) {
  tableState[key] ||= { filters: {}, sort: "", direction: "asc", page: 1, filterOpen: "" };
  return tableState[key];
}

function bulkSet(key) {
  bulkSelections[key] ||= new Set();
  return bulkSelections[key];
}

function bulkConfig(key) {
  const editable = {
    courses: "Programs",
    programs: "Course Master",
    teachers: "Teachers",
    registrations: "Registrations",
    "accommodation-blocks": "Blocks",
    "accommodation-floors": "Floors",
    "accommodation-rooms": "Rooms",
    halls: "Program Halls",
    "hall-bookings": "Hall Bookings",
    "access-users": "Users",
    "access-roles": "Roles"
  };
  return editable[key] ? { label: editable[key] } : null;
}

function renderSelectionCell(key, id) {
  if (!bulkConfig(key) || !canManageMasters()) return "";
  return `<td class="select-cell"><input type="checkbox" data-row-select="${key}" value="${id}" ${bulkSet(key).has(id) ? "checked" : ""} aria-label="Select row"></td>`;
}

function bulkFieldDefinitions(key) {
  const yesNo = [
    { value: "true", label: "Yes" },
    { value: "false", label: "No" }
  ];
  const activeInactive = [
    { value: "true", label: "Active" },
    { value: "false", label: "Inactive" }
  ];
  return {
    courses: [
      { name: "status", label: "Status", type: "select", options: ["Upcoming", "Active", "Completed"].map((value) => ({ value, label: value })) },
      { name: "hallId", label: "Program Hall", type: "select", options: state.halls.map((hall) => ({ value: hall.id, label: hall.name })) },
      { name: "seats", label: "Seats", type: "number" }
    ],
    programs: [
      { name: "level", label: "Level", type: "text" },
      { name: "duration", label: "Duration", type: "text" }
    ],
    teachers: [
      { name: "speciality", label: "Speciality", type: "text" }
    ],
    registrations: [
      { name: "status", label: "Status", type: "select", options: ["Pending", "Confirmed", "Waitlist", "Dropout", "Cancelled"].map((value) => ({ value, label: value })) },
      { name: "eligible", label: "Eligibility", type: "select", options: yesNo },
      { name: "paymentStatus", label: "Payment Status", type: "select", options: paymentStatuses.map((value) => ({ value, label: value })) },
      { name: "accommodationType", label: "Accommodation Type", type: "select", options: accommodationTypes.map((type) => ({ value: type, label: type })) },
      { name: "checkinDate", label: "Check-In Date", type: "date" },
      { name: "checkoutDate", label: "Check-Out Date", type: "date" },
      { name: "roomId", label: "Room", type: "select", options: [{ value: "", label: "Not assigned" }, ...state.rooms.map((room) => ({ value: room.id, label: room.name }))] }
    ],
    "accommodation-blocks": [
      { name: "notes", label: "Notes", type: "text" }
    ],
    "accommodation-floors": [
      { name: "blockId", label: "Block", type: "select", options: state.blocks.map((block) => ({ value: block.id, label: block.name })) }
    ],
    "accommodation-rooms": [
      { name: "floorId", label: "Floor", type: "select", options: state.floors.map((floor) => ({ value: floor.id, label: `${floor.name} - ${blockName(floor.blockId)}` })) },
      { name: "gender", label: "Room Type", type: "select", options: roomTypes.map((type) => ({ value: type, label: type })) },
      { name: "beds", label: "Beds", type: "number" }
    ],
    halls: [
      { name: "location", label: "Location", type: "text" },
      { name: "capacity", label: "Capacity", type: "number" }
    ],
    "hall-bookings": [
      { name: "hallId", label: "Program Hall", type: "select", options: state.halls.map((hall) => ({ value: hall.id, label: hall.name })) }
    ],
    "access-users": [
      { name: "active", label: "Login Access", type: "select", options: activeInactive }
    ],
    "access-roles": [
      { name: "active", label: "Role Status", type: "select", options: activeInactive }
    ]
  }[key] || [];
}

function openBulkEditDialog(key) {
  const selected = Array.from(bulkSet(key));
  if (!selected.length) return;
  const fields = bulkFieldDefinitions(key);
  if (!fields.length) {
    showToast("Bulk edit is not available for this table yet.");
    return;
  }
  const form = $("#bulkEditForm");
  form.reset();
  form.elements.tableKey.value = key;
  $("#bulkEditTitle").textContent = `Edit ${selected.length} ${bulkConfig(key)?.label || "Rows"}`;
  $("#bulkEditField").innerHTML = fields.map((field) => `<option value="${field.name}">${field.label}</option>`).join("");
  renderBulkValueInput(key);
  $("#bulkEditDialog").showModal();
}

function renderBulkValueInput(key) {
  const fieldName = $("#bulkEditField").value;
  const field = bulkFieldDefinitions(key).find((item) => item.name === fieldName);
  if (!field) {
    $("#bulkEditValue").innerHTML = "";
    return;
  }
  const control = field.type === "select"
    ? `<select name="value" required>${(field.options || []).map((option) => `<option value="${option.value}">${option.label}</option>`).join("")}</select>`
    : `<input name="value" type="${field.type}" required>`;
  $("#bulkEditValue").innerHTML = `<label>${field.label}${control}</label>`;
}

function setRegistrationMode(mode) {
  const isBulk = mode === "bulk";
  $("#registrationMode").value = isBulk ? "bulk" : "individual";
  $("#individualRegistrationFields").hidden = isBulk;
  $("#bulkRegistrationFields").hidden = !isBulk;
  $$("#registrationModeTabs button").forEach((button) => button.classList.toggle("is-selected", button.dataset.registrationMode === $("#registrationMode").value));
  $$("#individualRegistrationFields input, #individualRegistrationFields select, #individualRegistrationFields textarea").forEach((field) => {
    if (field.name === "photo" || field.name === "emergencyContact" || field.name === "address" || field.name === "notes") return;
    field.required = !isBulk;
  });
  $$("#bulkRegistrantRows input, #bulkRegistrantRows select, #bulkRegistrantRows textarea").forEach((field) => {
    const requiredBulkFields = ["name", "age", "gender", "phone", "email"];
    field.required = isBulk && requiredBulkFields.includes(field.dataset.bulkField);
  });
  if (isBulk && !document.querySelector(".bulk-registrant-row")) addBulkRegistrantRow();
}

function addBulkRegistrantRow(values = {}) {
  const rowId = newId("bulkRegistrant");
  const tiers = pricingTiersForCourse($("#courseSelect")?.value || "");
  $("#bulkRegistrantRows").insertAdjacentHTML("beforeend", `
    <div class="bulk-registrant-row" data-bulk-registrant-row="${rowId}">
      <div class="bulk-registrant-heading">
        <strong>Registrant</strong>
        <button class="icon-button" type="button" data-remove-bulk-registrant="${rowId}" aria-label="Remove registrant">x</button>
      </div>
      <div class="form-grid">
        <label>Name<input data-bulk-field="name" value="${values.name || ""}" required></label>
        <label>Age<input data-bulk-field="age" type="number" min="12" max="100" value="${values.age || ""}" required></label>
        <label>Gender
          <select data-bulk-field="gender" required>
            ${["Female", "Male", "Other"].map((gender) => `<option ${gender === (values.gender || "Female") ? "selected" : ""}>${gender}</option>`).join("")}
          </select>
        </label>
        <label>Phone<input data-bulk-field="phone" value="${values.phone || ""}" required></label>
        <label>Email ID<input data-bulk-field="email" type="email" value="${values.email || ""}" required></label>
        <label>Pricing Category
          <select data-bulk-field="pricingCategory">
            ${tiers.map((tier) => `<option value="${tier.category}" ${tier.category === (values.pricingCategory || tiers[0]?.category) ? "selected" : ""}>${tier.category} - ${tier.amount}</option>`).join("")}
          </select>
        </label>
        <label>Payment Status
          <select data-bulk-field="paymentStatus">
            ${paymentStatuses.map((status) => `<option ${status === (values.paymentStatus || "Enquiry") ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </label>
        <label>Accommodation Type
          <select data-bulk-field="accommodationType">
            ${accommodationTypes.map((type) => `<option ${type === (values.accommodationType || "Not Required") ? "selected" : ""}>${type}</option>`).join("")}
          </select>
        </label>
        <label>Emergency Contact<input data-bulk-field="emergencyContact" value="${values.emergencyContact || ""}"></label>
        <label class="wide">Address<textarea data-bulk-field="address" rows="2">${values.address || ""}</textarea></label>
        <label class="wide">Health Notes<textarea data-bulk-field="notes" rows="2">${values.notes || ""}</textarea></label>
      </div>
    </div>
  `);
}

function bulkRegistrantDetails() {
  return $$(".bulk-registrant-row").map((row) => {
    const valueFor = (field) => row.querySelector(`[data-bulk-field="${field}"]`)?.value || "";
    return {
      name: valueFor("name"),
      age: valueFor("age"),
      gender: valueFor("gender"),
      phone: valueFor("phone"),
      email: valueFor("email"),
      pricingCategory: valueFor("pricingCategory"),
      paymentStatus: valueFor("paymentStatus") || "Enquiry",
      accommodationType: valueFor("accommodationType") || "Not Required",
      photo: "",
      emergencyContact: valueFor("emergencyContact"),
      address: valueFor("address"),
      notes: valueFor("notes")
    };
  }).filter((item) => item.name.trim() || item.phone.trim() || item.email.trim());
}

function openRegistrationDialog(courseId = "") {
  $("#registrationForm").reset();
  $("#bulkRegistrantRows").innerHTML = "";
  renderCourseOptions();
  if (courseId) $("#courseSelect").value = courseId;
  renderRegistrationPricingOptions();
  setRegistrationMode("individual");
  const participant = currentParticipant();
  if (participant) {
    const form = $("#registrationForm");
    form.elements.name.value = participant.name || "";
    form.elements.age.value = participant.age || "";
    form.elements.gender.value = participant.gender || "Female";
    form.elements.phone.value = participant.phone || "";
    form.elements.email.value = participant.email || "";
    form.elements.photo.value = participant.photo || "";
    form.elements.emergencyContact.value = participant.emergencyContact || "";
    form.elements.address.value = participant.address || "";
    form.elements.notes.value = participant.notes || "";
  }
  $("#registrationDialog").showModal();
}

async function applyBulkEdit(form) {
  if (!canManageMasters()) return;
  const data = new FormData(form);
  const key = data.get("tableKey");
  const field = data.get("field");
  const value = data.get("value");
  const ids = Array.from(bulkSet(key));
  if (!ids.length) return;
  const boolValue = value === "true";
  ids.forEach((id) => {
    if (key === "courses") {
      const item = state.courses.find((course) => course.id === id);
      if (!item) return;
      if (field === "hallId") {
        item.hallId = value;
        item.hall = hallName(value);
        state.hallBookings.filter((booking) => booking.courseId === id).forEach((booking) => booking.hallId = value);
      } else if (field === "seats") item.seats = Number(value) || item.seats;
      else item[field] = value;
    }
    if (key === "programs") {
      const item = state.programs.find((program) => program.id === id);
      if (item) item[field] = value;
    }
    if (key === "teachers") {
      const item = state.teachers.find((teacher) => teacher.id === id);
      if (item) item[field] = value;
    }
    if (key === "registrations") {
      state.participants.forEach((participant) => registrationsForParticipant(participant).forEach((registration) => {
        if (registration.id !== id) return;
        if (field === "eligible") registration.eligible = boolValue;
        else if (field === "accommodationType") registration.accommodationType = normalizeAccommodationType(value);
        else if (field === "paymentStatus") {
          registration.paymentStatus = normalizePaymentStatus(value);
          registration.status = seatStatusForRegistration(registration.courseId, registration.paymentStatus, registration.id);
        }
        else registration[field] = value;
        if (registration === currentRegistration(participant)) syncParticipantFromRegistration(participant, registration);
      }));
    }
    if (key === "accommodation-blocks") {
      const item = state.blocks.find((block) => block.id === id);
      if (item) item[field] = value;
    }
    if (key === "accommodation-floors") {
      const item = state.floors.find((floor) => floor.id === id);
      if (item) item[field] = value;
    }
    if (key === "accommodation-rooms") {
      const item = state.rooms.find((room) => room.id === id);
      if (!item) return;
      if (field === "floorId") {
        const floor = state.floors.find((floorItem) => floorItem.id === value);
        if (!floor) return;
        item.floorId = value;
        item.blockId = floor.blockId;
      } else if (field === "beds") item.beds = Number(value) || item.beds;
      else if (field === "gender") item.gender = normalizeRoomType(value);
      else item[field] = value;
    }
    if (key === "halls") {
      const item = state.halls.find((hall) => hall.id === id);
      if (!item) return;
      if (field === "capacity") item.capacity = Number(value) || item.capacity;
      else item[field] = value;
    }
    if (key === "hall-bookings") {
      const item = state.hallBookings.find((booking) => booking.id === id);
      if (item) item[field] = value;
    }
  });
  if (key === "access-users") {
    const payload = field === "active" ? { active: boolValue, updated_at: new Date().toISOString() } : { [field]: value, updated_at: new Date().toISOString() };
    const result = await supabaseClient.from("user_roles").update(payload).in("user_id", ids);
    if (result.error) {
      showToast(friendlyErrorMessage(result.error, "Unable to update selected users."));
      return;
    }
    await loadAccessManagementData();
  } else if (key === "access-roles") {
    if (field === "active" && !boolValue && accessUsers.some((user) => ids.includes(user.role_id) && user.active)) {
      showToast("Cannot deactivate roles assigned to active users.");
      return;
    }
    const result = await supabaseClient.from("roles").update({ active: boolValue, updated_at: new Date().toISOString() }).in("id", ids);
    if (result.error) {
      showToast(friendlyErrorMessage(result.error, "Unable to update selected roles."));
      return;
    }
    await loadAccessManagementData();
  }
  bulkSet(key).clear();
  $("#bulkEditDialog").close();
  renderAll();
  showToast(`Bulk updated ${ids.length} row(s).`);
}

function ensureTableChrome(tbodyId, key, columns = []) {
  const tbody = $(`#${tbodyId}`);
  if (!tbody) return;
  const table = tbody.closest("table");
  if (!table) return;
  const stateForTable = tableConfig(key);
  const headerRow = table.querySelector("thead tr");
  if (headerRow) {
    const selectionHeader = bulkConfig(key) && canManageMasters()
      ? `<th class="select-cell"><input type="checkbox" data-row-select-all="${key}" aria-label="Select visible rows"></th>`
      : "";
    headerRow.innerHTML = selectionHeader + columns.map((column) => tableHeaderCell(key, column, stateForTable)).join("");
  }
  let footer = table.querySelector(`tfoot[data-table-pagination="${key}"]`);
  if (!footer) {
    table.insertAdjacentHTML("beforeend", `<tfoot data-table-pagination="${key}"></tfoot>`);
  }
}

function tableHeaderCell(tableKey, column, stateForTable) {
  const filterValue = stateForTable.filters[column.key] || "";
  const isSorted = stateForTable.sort === column.key;
  const direction = isSorted ? stateForTable.direction : "";
  const isFilterOpen = stateForTable.filterOpen === column.key;
  const hasFilter = Boolean(filterValue.trim());
  const sortIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 3-3 3 3"></path><path d="M10 4v16"></path><path d="m17 17-3 3-3-3"></path><path d="M14 20V4"></path></svg>`;
  const filterIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18"></path><path d="M7 12h10"></path><path d="M10 19h4"></path></svg>`;
  const filter = column.filter === false ? "" : `
    <button class="column-action-button ${isFilterOpen || hasFilter ? "is-active" : ""} ${hasFilter ? "has-filter" : ""}" type="button" data-column-filter-toggle="${tableKey}" data-column-key="${column.key}" title="Filter ${column.label}" aria-label="Filter ${column.label}">
      ${filterIcon}
    </button>
  `;
  const filterControl = column.filter === false || !isFilterOpen ? "" : `
    <div class="column-filter-row">
      <input class="column-filter" type="search" data-column-filter="${tableKey}" data-column-key="${column.key}" value="${filterValue}" placeholder="Filter ${column.label}">
    </div>
  `;
  const sort = column.sort === false ? "" : `
    <button class="column-action-button ${isSorted ? "is-active" : ""}" type="button" data-column-sort="${tableKey}" data-column-key="${column.key}" title="Sort ${column.label}" aria-label="Sort ${column.label}">
      ${sortIcon}
      ${isSorted ? `<span class="sort-direction">${direction === "desc" ? "DESC" : "ASC"}</span>` : ""}
    </button>
  `;
  return `<th>
    <div class="column-header">
      <span>${column.label}</span>
      <span class="column-actions">${sort}${filter}</span>
    </div>
    ${filterControl}
  </th>`;
}

function tableRows(key, rows, columns, sorters) {
  const stateForTable = tableConfig(key);
  let filtered = rows.filter((row) => columns.every((column) => {
    const filterValue = (stateForTable.filters[column.key] || "").trim().toLowerCase();
    if (!filterValue || column.filter === false) return true;
    return String(column.value(row) ?? "").toLowerCase().includes(filterValue);
  }));
  const sortableColumns = columns.filter((column) => column.sort !== false);
  stateForTable.sort ||= sortableColumns[0]?.key || "";
  const sorter = sorters[stateForTable.sort] || ((a, b) => String(columns.find((column) => column.key === stateForTable.sort)?.value(a) ?? "").localeCompare(String(columns.find((column) => column.key === stateForTable.sort)?.value(b) ?? "")));
  if (sorter) {
    filtered = [...filtered].sort((a, b) => sorter(a, b) * (stateForTable.direction === "desc" ? -1 : 1));
  }
  const pageCount = Math.max(1, Math.ceil(filtered.length / tablePageSize));
  stateForTable.page = Math.min(Math.max(1, stateForTable.page), pageCount);
  const start = (stateForTable.page - 1) * tablePageSize;
  return {
    rows: filtered.slice(start, start + tablePageSize),
    total: rows.length,
    filtered: filtered.length,
    pageCount,
    page: stateForTable.page
  };
}

function renderTablePagination(key, result) {
  const pagination = document.querySelector(`tfoot[data-table-pagination="${key}"]`);
  if (!pagination) return;
  const colspan = pagination.closest("table")?.querySelectorAll("thead th").length || 1;
  const selectedCount = bulkSet(key).size;
  const bulkAction = bulkConfig(key) && canManageMasters() ? `
    <button class="secondary-button" type="button" data-bulk-edit="${key}" ${selectedCount ? "" : "disabled"}>Bulk Edit</button>
    ${selectedCount ? `<button class="secondary-button" type="button" data-bulk-clear="${key}">Clear</button>` : ""}
  ` : "";
  pagination.innerHTML = `<tr><td colspan="${colspan}">
    <div class="table-footer">
      <span>${result.filtered ? `${(result.page - 1) * tablePageSize + 1}-${Math.min(result.page * tablePageSize, result.filtered)} of ${result.filtered}${result.filtered === result.total ? "" : ` filtered from ${result.total}`}` : "No matching records"}${selectedCount ? ` | ${selectedCount} selected` : ""}</span>
      <div class="row-actions">
        ${bulkAction}
        <button class="secondary-button" type="button" data-table-page="${key}" data-page-direction="previous" ${result.page === 1 ? "disabled" : ""}>Previous</button>
        <strong>Page ${result.page} / ${result.pageCount}</strong>
        <button class="secondary-button" type="button" data-table-page="${key}" data-page-direction="next" ${result.page === result.pageCount ? "disabled" : ""}>Next</button>
      </div>
    </div>
  </td></tr>`;
}

function newId(prefix) {
  const sequenceConfig = {
    program: { prefix: "COURSE", records: () => state.programs },
    course: { prefix: "PROG", records: () => state.courses },
    registration: { prefix: "REG", records: () => allRegistrationRows().map(({ registration }) => registration) },
    participant: { prefix: "PART", records: () => state.participants }
  }[prefix];
  if (sequenceConfig) {
    const matcher = new RegExp(`^${sequenceConfig.prefix}-(\\d+)$`);
    const max = sequenceConfig.records()
      .map((record) => String(record.id || "").match(matcher))
      .filter(Boolean)
      .reduce((highest, match) => Math.max(highest, Number(match[1]) || 0), 0);
    return `${sequenceConfig.prefix}-${String(max + 1).padStart(4, "0")}`;
  }
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

function renderNav() {
  const permitted = allowedViews();
  $("#nav").innerHTML = navGroups
    .map((group) => {
      const items = group.items.filter(([id]) => permitted.includes(id));
      if (!items.length) return "";
      return `<div class="nav-section">
        <span class="nav-section-title">${group.label}</span>
        ${items.map(([id, label]) => `<button type="button" data-view="${id}" class="${id === currentViewId() ? "is-active" : ""}">${label}</button>`).join("")}
      </div>`;
    })
    .join("");
  $("#nav").onclick = (event) => {
    const button = event.target.closest("button[data-view]");
    if (!button) return;
    resetRecordDetailViews();
    linkBackStack = [];
    if (button.dataset.view === "programs") courseMasterTab = "details";
    activateView(button.dataset.view);
    renderAll();
  };
}

function resetRecordDetailViews() {
  openDetailView = { courses: false, programs: false, teachers: false, participants: false };
}

function activateView(id) {
  const candidateId = views.some(([viewId]) => viewId === id) ? id : "portal";
  const targetId = canAccessView(candidateId) ? candidateId : defaultViewForRole();
  $$("#nav button").forEach((button) => button.classList.toggle("is-active", button.dataset.view === targetId));
  const targetView = $(`#${targetId}`);
  if (targetView) {
    $$(".view").forEach((view) => view.classList.toggle("is-active", view.id === targetId));
    $("#pageTitle").textContent = targetView.dataset.title;
  }
}

function currentViewId() {
  return document.querySelector(".view.is-active")?.id || "portal";
}

function currentSelectionState(label = "Back") {
  return {
    label,
    selectedCourseId,
    selectedProgramId,
    selectedParticipantId,
    selectedTeacherId,
    viewId: currentViewId()
  };
}

function restoreSelectionState(stateSnapshot) {
  selectedCourseId = stateSnapshot.selectedCourseId;
  selectedProgramId = stateSnapshot.selectedProgramId;
  selectedParticipantId = stateSnapshot.selectedParticipantId;
  selectedTeacherId = stateSnapshot.selectedTeacherId;
  activateView(stateSnapshot.viewId);
  renderAll();
}

function openLinkedRecord(viewId, selections = {}, label = "Back") {
  linkBackStack.push(currentSelectionState(label));
  if (selections.courseId) selectedCourseId = selections.courseId;
  if (selections.programId) selectedProgramId = selections.programId;
  if (selections.participantId) selectedParticipantId = selections.participantId;
  if (selections.teacherId) selectedTeacherId = selections.teacherId;
  if (viewId === "courses") openDetailView.courses = true;
  if (viewId === "programs") openDetailView.programs = true;
  if (viewId === "teachers") openDetailView.teachers = true;
  if (viewId === "participants") openDetailView.participants = true;
  activateView(viewId);
  renderAll();
}

function backLinkHtml() {
  const last = linkBackStack[linkBackStack.length - 1];
  return last ? `<button class="secondary-button link-back-button" type="button" data-link-back>${last.label}</button>` : "";
}

function renderAuthState() {
  document.body.classList.toggle("public-portal", currentSession.role === "public");
  const card = $("#authCard");
  if (!card) return;
  const roleLabel = currentSession.role[0].toUpperCase() + currentSession.role.slice(1);
  card.innerHTML = currentSession.role === "public" ? `
    <span>Access</span>
    <strong>Public Portal</strong>
    <small>Registration is open without login</small>
    <small>${remoteStatus}</small>
  ` : `
    <span>Logged in as ${roleLabel}</span>
    <strong>${currentSession.name}</strong>
    <small>${remoteStatus}</small>
    <button class="ghost-button full" id="logoutButton" type="button">Logout</button>
  `;
}

function renderPortal() {
  const filterText = portalProgramFilter.trim().toLowerCase();
  const upcomingPrograms = state.courses
    .filter(isPortalProgram)
    .filter((course) => {
      if (!filterText) return true;
      return [course.name, course.eligibility, course.start, course.end].join(" ").toLowerCase().includes(filterText);
    })
    .sort((a, b) => {
      if (portalProgramSort === "startDesc") return dateFromInput(b.start) - dateFromInput(a.start);
      if (portalProgramSort === "nameAsc") return a.name.localeCompare(b.name);
      return dateFromInput(a.start) - dateFromInput(b.start);
    });
  const pageCount = Math.max(1, Math.ceil(upcomingPrograms.length / portalProgramPageSize));
  portalProgramPage = Math.min(Math.max(1, portalProgramPage), pageCount);
  const visiblePrograms = upcomingPrograms.slice((portalProgramPage - 1) * portalProgramPageSize, portalProgramPage * portalProgramPageSize);
  const rows = visiblePrograms.map((course) => {
    return `<tr>
      <td><strong>${course.name}</strong><br><span class="muted">${course.eligibility}</span><br><span class="pill ${statusClass(course.status || programLifecycleStatus(course))}">${course.status || programLifecycleStatus(course)}</span></td>
      <td>${course.start}<br><span class="muted">${course.end}</span></td>
      <td><button class="secondary-button" type="button" data-public-register="${course.id}">Register</button></td>
    </tr>`;
  }).join("");
  $("#portalBatchRows").innerHTML = rows || `<tr><td colspan="3"><span class="muted">No upcoming programs are open for registration.</span></td></tr>`;
  $("#portalPagination").innerHTML = upcomingPrograms.length ? `
    <span>${(portalProgramPage - 1) * portalProgramPageSize + 1}-${Math.min(portalProgramPage * portalProgramPageSize, upcomingPrograms.length)} of ${upcomingPrograms.length}</span>
    <div class="row-actions">
      <button class="secondary-button" type="button" data-portal-page="previous" ${portalProgramPage === 1 ? "disabled" : ""}>Previous</button>
      <strong>Page ${portalProgramPage} / ${pageCount}</strong>
      <button class="secondary-button" type="button" data-portal-page="next" ${portalProgramPage === pageCount ? "disabled" : ""}>Next</button>
    </div>
  ` : "";
}

function renderPermissionChrome() {
  const adminControls = [
    "#addProgram",
    "#addCourse",
    "#addAccommodationRecord",
    "#addHall",
    "#addHallBooking",
    "#addAccessUser",
    "#addAccessRole",
    "#generateCertificates"
  ];
  adminControls.forEach((selector) => {
    const element = $(selector);
    if (element) element.hidden = !canManageMasters();
  });
  const participantAddButton = $("#addParticipantFromMaster");
  if (participantAddButton) participantAddButton.hidden = !canManageMasters();
}

function renderMetrics() {
  if (!$("#metrics")) return;
  const registrations = allRegistrationRows();
  const confirmed = registrations.filter(({ registration }) => registration.status === "Confirmed").length;
  const pending = registrations.filter(({ registration }) => registration.status === "Pending").length;
  const waitlist = registrations.filter(({ registration }) => registration.status === "Waitlist").length;
  const occupied = registrations.filter(({ registration }) => registration.roomId).length;
  const beds = state.rooms.reduce((sum, room) => sum + room.beds, 0);
  const certificates = registrations.filter(({ registration }) => registration.certificate).length;
  const data = [
    ["Confirmed", confirmed],
    ["Pending Review", pending],
    ["Waitlist", waitlist],
    ["Beds Used", `${occupied}/${beds}`],
    ["Certificates", certificates]
  ];
  $("#metrics").innerHTML = data.map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`).join("");
}

function renderDashboard() {
  renderCalendar();
}

function renderCalendar() {
  const year = calendarDate.getFullYear();
  const month = calendarDate.getMonth();
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month, daysInMonth);
  const gridStart = new Date(year, month, 1 - startOffset);
  const today = new Date();
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const activePrograms = state.courses
    .map((course) => ({ course, start: dateFromInput(course.start), end: dateFromInput(course.end) }))
    .filter(({ course, start, end }) => {
      if (!start || !end) return false;
      if (programLifecycleStatus(course) === "Completed") return false;
      return start <= monthEnd && end >= monthStart;
    })
    .sort((first, second) => first.start - second.start || first.end - second.end || first.course.name.localeCompare(second.course.name));

  $("#calendarTitle").textContent = formatMonthTitle(calendarDate);
  const header = `<div class="calendar-weekdays">${weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`).join("")}</div>`;
  const weeks = Array.from({ length: totalCells / 7 }, (_, weekIndex) => {
    const weekStart = new Date(gridStart);
    weekStart.setDate(gridStart.getDate() + (weekIndex * 7));
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const segments = activePrograms.flatMap(({ course, start, end }) => {
      const segmentStart = new Date(Math.max(start.getTime(), weekStart.getTime(), monthStart.getTime()));
      const segmentEnd = new Date(Math.min(end.getTime(), weekEnd.getTime(), monthEnd.getTime()));
      if (segmentStart > segmentEnd) return [];
      return [{
        course,
        start,
        end,
        segmentStart,
        segmentEnd,
        startCol: segmentStart.getDay() + 1,
        endCol: segmentEnd.getDay() + 1
      }];
    });
    const laneEnds = [];
    segments.forEach((segment) => {
      const lane = laneEnds.findIndex((endCol) => segment.startCol > endCol);
      segment.lane = lane >= 0 ? lane : laneEnds.length;
      laneEnds[segment.lane] = segment.endCol;
    });
    const laneCount = Math.max(laneEnds.length, 1);
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + dayIndex);
      const inMonth = date.getMonth() === month;
      return `<div class="calendar-day ${inMonth ? "" : "is-empty"} ${isSameDate(date, today) ? "is-today" : ""}" style="grid-column: ${dayIndex + 1}; grid-row: 1 / span ${laneCount + 1};">
        ${inMonth ? `<div class="calendar-date">${date.getDate()}</div>` : ""}
      </div>`;
    }).join("");
    const programBars = segments.map((segment) => {
      const beginsHere = isSameDate(segment.segmentStart, segment.start);
      const endsHere = isSameDate(segment.segmentEnd, segment.end);
      const marker = beginsHere && endsHere ? "Full Program" : beginsHere ? "Starts" : endsHere ? "Ends" : "Continues";
      return `<button
        class="calendar-program ${beginsHere ? "is-start" : "is-continuation"} ${endsHere ? "is-end" : ""}"
        type="button"
        data-course-open="${segment.course.id}"
        title="${segment.course.name} | ${segment.course.start} to ${segment.course.end}"
        style="grid-column: ${segment.startCol} / ${segment.endCol + 1}; grid-row: ${segment.lane + 2};"
      ><span>${marker}</span>${segment.course.name}</button>`;
    }).join("");
    return `<div class="calendar-week" style="--calendar-lanes: ${laneCount};">${days}${programBars}</div>`;
  }).join("");
  $("#programCalendar").innerHTML = header + weeks;
}

function renderCourses() {
  const courses = visibleCourses().filter((course) => programListFilter === "all" || programLifecycleStatus(course) !== "Completed");
  $$("#programListFilter button").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.programListFilter === programListFilter);
  });
  if (!selectedCourseId || !courses.some((course) => course.id === selectedCourseId)) {
    selectedCourseId = courses[0]?.id || "";
  }
  const layout = document.querySelector(".batches-master-layout");
  if (layout) layout.classList.toggle("detail-open", openDetailView.courses);
  const columns = [
    { key: "name", label: "Program", value: (course) => course.name },
    { key: "start", label: "Schedule", value: (course) => `${course.start} ${course.end}` },
    { key: "teacher", label: "Teacher", value: (course) => course.teacher },
    { key: "seats", label: "Seats", value: (course) => Number(course.seats) },
    { key: "hall", label: "Hall", value: (course) => course.hall },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  ensureTableChrome("batchRows", "courses", columns);
  const result = tableRows("courses", courses, columns, {
    start: (a, b) => dateFromInput(a.start) - dateFromInput(b.start),
    name: (a, b) => a.name.localeCompare(b.name),
    teacher: (a, b) => a.teacher.localeCompare(b.teacher),
    seats: (a, b) => Number(a.seats) - Number(b.seats),
    hall: (a, b) => a.hall.localeCompare(b.hall)
  });
  $("#batchRows").innerHTML = result.rows.map((course) => {
    const registered = paidOrApprovedRegistrationsForCourse(course.id).length;
    const sessions = courseSessionPlan(course.id);
    const status = course.status || programLifecycleStatus(course);
    return `
      <tr class="batch-master-row ${selectedCourseId === course.id ? "participant-row-selected" : ""}" data-batch-view="${course.id}" tabindex="0">
        ${renderSelectionCell("courses", course.id)}
        <td><strong>${course.name}</strong><br><span class="muted">${course.eligibility} | ${sessions.length} session(s)</span><br><span class="pill ${statusClass(status)}">${status}</span></td>
        <td>${course.start}<br><span class="muted">${course.end}</span></td>
        <td>${teacherByName(course.teacher) ? `<button class="text-link-button" type="button" data-linked-teacher="${teacherByName(course.teacher).id}">${course.teacher}</button>` : course.teacher}</td>
        <td>${registered}/${course.seats}</td>
        <td>${course.hall}</td>
        <td>
          <div class="row-actions">
            ${canManageMasters() ? `<button class="secondary-button" type="button" data-course-edit="${course.id}">Edit</button><button class="danger-button" type="button" data-course-delete="${course.id}">Delete</button>` : ""}
            ${status !== "Completed" ? `<button class="secondary-button" type="button" data-course-register="${course.id}">Register</button>` : "<span class=\"muted\">Not available</span>"}
          </div>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="${canManageMasters() ? 7 : 6}"><span class="muted">No programs found.</span></td></tr>`;
  renderTablePagination("courses", result);
  renderBatchDetail();
}

function renderBatchDetail() {
  const course = visibleCourses().find((item) => item.id === selectedCourseId);
  if (!course) {
    $("#batchDetail").innerHTML = `<p class="muted">No programs scheduled yet.</p>`;
    return;
  }
  const registered = paidOrApprovedRegistrationsForCourse(course.id).length;
  const attendanceRows = currentSession.role === "participant"
    ? visibleRegistrationRows().filter(({ registration }) => registration.courseId === course.id && registration.status === "Confirmed")
    : registrationRowsForCourse(course.id);
  const sessions = courseSessionPlan(course.id);
  const completedCount = attendanceRows.filter(({ registration }) => registration.completion === "Completed").length;
  const teacher = teacherByName(course.teacher);
  const status = course.status || programLifecycleStatus(course);
  const showBatchActions = canManageMasters();
  const allowAttendance = canMarkAttendance();
  const reRegistrationRows = allRegistrationRows().filter(({ registration }) => registration.courseId === course.id && String(registration.notes || "").startsWith("Auto re-registration"));
  $("#batchDetail").innerHTML = `
    <button class="secondary-button link-back-button" type="button" data-record-back="courses">Back to Programs</button>
    ${backLinkHtml()}
    <div class="batch-detail-heading">
      <div>
        <h3>${course.name}</h3>
        <p class="muted">${course.eligibility} | ${status}</p>
      </div>
      <div class="row-actions">
        ${showBatchActions ? `<button class="secondary-button" type="button" data-course-edit="${course.id}">Edit Program</button><button class="danger-button" type="button" data-course-delete="${course.id}">Delete Program</button>` : ""}
      </div>
    </div>
    <div class="course-meta detail-meta">
      <div><span>Schedule</span><strong>${course.start}<br>${course.end}</strong></div>
      <div><span>Seats</span><strong>${registered}/${course.seats}</strong></div>
      <div><span>Teacher</span><strong>${teacher ? `<button class="text-link-button" type="button" data-linked-teacher="${teacher.id}">${course.teacher}</button>` : course.teacher}</strong></div>
      <div><span>Hall</span><strong>${course.hall}</strong></div>
      <div><span>Status</span><strong><span class="pill ${statusClass(status)}">${status}</span></strong></div>
      <div><span>Completed</span><strong>${completedCount}/${attendanceRows.length}</strong></div>
      <div><span>Sessions</span><strong>${sessions.length} session(s)</strong></div>
    </div>
    <section class="batch-attendance-panel">
      <div class="subform-header">
        <h3>Re-Registration Queue</h3>
        <span class="muted">Past waitlisted, cancelled, and dropout candidates automatically carried forward</span>
      </div>
      <div class="table-wrap subform-table">
        <table>
          <thead><tr><th>Participant</th><th>Source</th><th>Payment</th><th>Status</th></tr></thead>
          <tbody>
            ${reRegistrationRows.length ? reRegistrationRows.map(({ participant, registration }) => `
              <tr>
                <td><button class="text-link-button" type="button" data-linked-participant="${participant.id}">${participant.name}</button><br><span class="muted">${participant.phone || participant.email || ""}</span></td>
                <td>${registration.notes}</td>
                <td>${normalizePaymentStatus(registration.paymentStatus)}<br><span class="muted">${registration.pricingCategory || "General"} | ${Number(registration.amount) || 0}</span></td>
                <td><span class="pill ${statusClass(registration.status)}">${registration.status}</span></td>
              </tr>
            `).join("") : `<tr><td colspan="4"><span class="muted">No automatic re-registration records for this program.</span></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    <section class="batch-attendance-panel">
      <div class="subform-header">
        <h3>Session Plan</h3>
        <span class="muted">Planned in Course Master and applied to this program</span>
      </div>
      <div class="table-wrap subform-table session-plan-table">
        <table>
          <thead><tr><th>Date</th><th>Time</th><th>Session</th><th>Topic</th><th>Source</th></tr></thead>
          <tbody>
            ${sessions.map((session) => `
              <tr>
                <td>${session.date}</td>
                <td>${session.time}</td>
                <td>${session.title}</td>
                <td>${session.topic}</td>
                <td><span class="muted">Course Master</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="batch-attendance-panel">
      <div class="subform-header">
        <h3>Session Attendance</h3>
        <span class="muted">${attendanceRows.length} confirmed participant(s) | ${sessions.length} session(s)</span>
      </div>
      <div class="table-wrap attendance-table">
        <table>
          <thead>
            <tr>
              <th>Participant</th>
              ${sessions.map((session, index) => {
                const stats = attendanceRows.reduce((summary, { registration }) => {
                  const record = attendanceForSession(registration, session.id);
                  const status = record?.status || "Pending";
                  summary[status] = (summary[status] || 0) + 1;
                  return summary;
                }, {});
                return `<th>
                  <div class="attendance-session-heading">
                    <strong>S${index + 1}</strong>
                    <span class="muted">${session.date.slice(5)} | ${session.title}</span>
                    <small>${stats.Present || 0} present | ${stats.Late || 0} late | ${stats.Absent || 0} absent</small>
                    ${allowAttendance ? `<button class="secondary-button compact-action" type="button" data-mark-session-present="${session.id}" data-course-id="${course.id}">Mark all Present</button>` : ""}
                  </div>
                </th>`;
              }).join("")}
              <th>Completion</th>
            </tr>
          </thead>
          <tbody>
            ${attendanceRows.length ? attendanceRows.map(({ participant, registration }) => `
              <tr>
                <td><strong><button class="text-link-button" type="button" data-linked-participant="${participant.id}">${participant.name}</button></strong><br><span class="muted">${participant.phone}</span></td>
                ${sessions.map((session) => {
                  const record = attendanceForSession(registration, session.id);
                  const locked = hasEarlierSessionAbsence(registration, session.id) && !record;
                  const status = record?.status || "Pending";
                  const attendanceButtons = [
                    ["Present", "P"],
                    ["Late", "L"],
                    ["Absent", "A"]
                  ].map(([buttonStatus, label]) => `
                    <button
                      type="button"
                      class="${record?.status === buttonStatus ? "is-selected" : ""}"
                      title="${locked ? "Blocked after earlier absence" : `Mark ${buttonStatus}`}"
                      data-attendance-status="${buttonStatus}"
                      data-id="${participant.id}"
                      data-registration-id="${registration.id}"
                      data-session-id="${session.id}"
                      ${locked ? "disabled" : ""}
                    >${label}</button>
                  `).join("");
                  return `<td>
                    <div class="attendance-cell">
                      <span class="pill ${statusClass(status)}">${status}</span>
                      <small>${session.time}<br>${session.topic}</small>
                      ${record?.reason ? `<small>${record.reason}</small>` : ""}
                      ${allowAttendance ? `<div class="attendance-actions">
                        ${attendanceButtons}
                      </div>` : ""}
                    </div>
                  </td>`;
                }).join("")}
                <td><span class="pill ${statusClass(registration.completion)}">${registration.completion}</span><br><span class="muted">${registration.attendance}/${sessions.length} attended</span></td>
              </tr>
            `).join("") : `<tr><td colspan="${sessions.length + 2}"><span class="muted">No confirmed participants for this program yet.</span></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderPrograms() {
  if (!selectedProgramId || !state.programs.some((program) => program.id === selectedProgramId)) {
    selectedProgramId = state.programs.find((program) => program.parentId)?.id || state.programs[0]?.id || "";
  }
  const layout = document.querySelector(".program-master-layout");
  if (layout) {
    layout.classList.toggle("detail-open", openDetailView.programs);
    layout.dataset.activeTab = courseMasterTab;
  }
  $("#courseMasterTabs")?.classList.toggle("is-hidden", openDetailView.programs);
  $$("#courseMasterTabs button").forEach((button) => button.classList.toggle("is-selected", button.dataset.courseMasterTab === courseMasterTab));
  const childrenFor = (parentId) => state.programs.filter((program) => program.parentId === parentId);
  const renderNode = (program) => {
    const children = childrenFor(program.id);
    return `<div class="program-node ${program.parentId ? "is-child" : "is-parent"} ${program.id === selectedProgramId ? "is-selected" : ""}" data-program-view="${program.id}" tabindex="0">
      <div>
        <strong>${program.name}</strong>
        <span>${program.code} | ${program.level}${program.duration ? ` | ${program.duration}` : ""}</span>
      </div>
      <div class="row-actions compact-actions">
        <button class="secondary-button" type="button" data-program-edit="${program.id}">Edit</button>
        <button class="danger-button" type="button" data-program-delete="${program.id}">Delete</button>
      </div>
      ${children.length ? `<div class="program-children">${children.map(renderNode).join("")}</div>` : ""}
    </div>`;
  };
  $("#programHierarchy").innerHTML = childrenFor("").map(renderNode).join("");
  const columns = [
    { key: "name", label: "Course", value: (program) => program.name },
    { key: "code", label: "Code", value: (program) => program.code },
    { key: "level", label: "Level", value: (program) => program.level },
    { key: "duration", label: "Duration", value: (program) => program.duration || "Varies" },
    { key: "eligibility", label: "Eligibility", value: (program) => program.eligibility },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  ensureTableChrome("programRows", "programs", columns);
  const result = tableRows("programs", state.programs, columns, {
    name: (a, b) => a.name.localeCompare(b.name),
    code: (a, b) => a.code.localeCompare(b.code),
    level: (a, b) => a.level.localeCompare(b.level),
    duration: (a, b) => (a.duration || "").localeCompare(b.duration || ""),
    eligibility: (a, b) => a.eligibility.localeCompare(b.eligibility)
  });
  $("#programRows").innerHTML = result.rows.map((program) => `
    <tr class="program-master-row ${program.id === selectedProgramId ? "participant-row-selected" : ""}" data-program-view="${program.id}" tabindex="0">
      ${renderSelectionCell("programs", program.id)}
      <td><strong>${program.name}</strong><br><span class="muted">${program.parentId ? `Under ${state.programs.find((item) => item.id === program.parentId)?.name || "Root"}` : "Root course family"}</span></td>
      <td>${program.code}</td>
      <td>${program.level}</td>
      <td>${program.duration || "<span class=\"muted\">Varies</span>"}</td>
      <td>${program.eligibility}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" type="button" data-program-edit="${program.id}">Edit</button>
          <button class="danger-button" type="button" data-program-delete="${program.id}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("") || `<tr><td colspan="${canManageMasters() ? 7 : 6}"><span class="muted">No courses found.</span></td></tr>`;
  renderTablePagination("programs", result);
  renderProgramDetail();
}

function programChildren(programId) {
  return state.programs.filter((program) => program.parentId === programId);
}

function programAncestors(program) {
  const ancestors = [];
  let current = program;
  while (current?.parentId) {
    current = state.programs.find((item) => item.id === current.parentId);
    if (current) ancestors.unshift(current);
  }
  return ancestors;
}

function conductedProgramsForCourse(program) {
  if (!program) return [];
  const collectIds = (programId) => [programId, ...programChildren(programId).flatMap((child) => collectIds(child.id))];
  const hierarchyIds = new Set(collectIds(program.id));
  const hierarchyNames = new Set(state.programs.filter((item) => hierarchyIds.has(item.id)).map((item) => item.name));
  return state.courses.filter((course) => hierarchyIds.has(course.programId) || (!course.programId && hierarchyNames.has(course.name)));
}

function coursesMappedToTeacher(teacher) {
  if (!teacher) return [];
  return state.programs.filter((program) => (program.teacherIds || []).includes(teacher.id));
}

function renderProgramHierarchyContext(program) {
  const ancestors = programAncestors(program);
  const children = programChildren(program.id);
  return `
    <div class="course-hierarchy-context">
      ${ancestors.length ? `<div class="hierarchy-line">${ancestors.map((item) => `<span>${item.name}</span>`).join("<strong>&rsaquo;</strong>")}<strong>&rsaquo;</strong><span class="is-current">${program.name}</span></div>` : `<div class="hierarchy-line"><span class="is-current">${program.name}</span></div>`}
      ${children.length ? `<div class="program-tree compact-tree">${children.map((child) => `
        <div class="program-node is-child">
          <strong>${child.name}</strong>
          <span>${child.code} | ${child.level}${child.duration ? ` | ${child.duration}` : ""}</span>
        </div>
      `).join("")}</div>` : `<span class="muted">No child courses under this course.</span>`}
    </div>
  `;
}

function renderProgramDetail() {
  const program = state.programs.find((item) => item.id === selectedProgramId);
  if (!program) {
    $("#programDetail").innerHTML = `<p class="muted">No courses recorded yet.</p>`;
    return;
  }
  const sessions = program.sessionTemplates || [];
  const associatedTeachers = mappedTeachersForProgram(program.id);
  const conducted = conductedProgramsForCourse(program);
  $("#programDetail").innerHTML = `
    <div class="batch-detail-heading">
      <div>
        <h3>${program.name}</h3>
        <p class="muted">${program.code} | ${program.level}${program.duration ? ` | ${program.duration}` : ""}</p>
      </div>
      <div class="row-actions">
        ${canManageMasters() ? `<button class="secondary-button" type="button" data-program-edit="${program.id}">Edit Course</button>` : ""}
      </div>
    </div>
    <div class="course-meta detail-meta">
      <div><span>Duration</span><strong>${program.duration || "Varies"}</strong></div>
      <div><span>Eligibility</span><strong>${program.eligibility}</strong></div>
      <div><span>Parent Course</span><strong>${state.programs.find((item) => item.id === program.parentId)?.name || "Root course family"}</strong></div>
      <div><span>Child Courses</span><strong>${programChildren(program.id).length}</strong></div>
      <div><span>Teachers</span><strong>${associatedTeachers.length}</strong></div>
      <div><span>Pricing Categories</span><strong>${normalizePricingTiers(program.pricingTiers).length}</strong></div>
      <div><span>Session Plan</span><strong>${sessions.length} session(s)</strong></div>
      <div><span>Programs Conducted</span><strong>${conducted.length}</strong></div>
    </div>
    <section class="participant-subform">
      <div class="subform-header">
        <h3>Course Hierarchy</h3>
        <span class="muted">Context for this course</span>
      </div>
      ${renderProgramHierarchyContext(program)}
    </section>
    <section class="participant-subform">
      <div class="subform-header">
        <div>
          <h3>Course Pricing</h3>
          <span class="muted">Participant category wise pricing</span>
        </div>
      </div>
      <div class="table-wrap subform-table">
        <table>
          <thead><tr><th>Category</th><th>Amount</th></tr></thead>
          <tbody>
            ${normalizePricingTiers(program.pricingTiers).map((tier) => `<tr><td>${tier.category}</td><td>${tier.amount}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </section>
    <section class="participant-subform">
      <div class="subform-header">
        <h3>Associated Teachers</h3>
        <span class="muted">${associatedTeachers.length} teacher(s)</span>
      </div>
      <div class="teacher-association-list">
        ${associatedTeachers.length ? associatedTeachers.map((teacher) => `
          <button class="teacher-association-pill" type="button" ${teacher.isVirtual ? "" : `data-linked-teacher="${teacher.id}"`}>
            <strong>${teacherDisplayName(teacher)}</strong>
            <span>${teacher.speciality || "Faculty"}${teacher.isVirtual ? " | active user" : ""}</span>
          </button>
        `).join("") : `<span class="muted">No teachers are associated with this course yet. Edit Course to add teachers.</span>`}
      </div>
    </section>
    <section class="participant-subform">
      <div class="subform-header">
        <div>
          <h3>Course Session Plan</h3>
          <span class="muted">Applied to programs scheduled from this course</span>
        </div>
        ${canManageMasters() ? `<button class="primary-button" type="button" data-program-session-add="${program.id}">Add Session</button>` : ""}
      </div>
      <div class="table-wrap subform-table">
        <table>
          <thead><tr><th>Day</th><th>Time</th><th>Session</th><th>Topic</th><th>Actions</th></tr></thead>
          <tbody>
            ${sessions.length ? sessions.map((session) => `
              <tr>
                <td>Day ${session.day}</td>
                <td>${session.time}</td>
                <td>${session.title}</td>
                <td>${session.topic}</td>
                <td>${canManageMasters() ? `<div class="row-actions"><button class="secondary-button" type="button" data-program-session-edit="${program.id}" data-session-template-id="${session.id}">Edit</button><button class="danger-button" type="button" data-program-session-delete="${program.id}" data-session-template-id="${session.id}">Delete</button></div>` : "<span class=\"muted\">View only</span>"}</td>
              </tr>
            `).join("") : `<tr><td colspan="5"><span class="muted">No sessions planned for this course.</span></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    <section class="participant-subform">
      <div class="subform-header">
        <h3>Programs Conducted</h3>
        <span class="muted">${conducted.length} record(s)</span>
      </div>
      <div class="table-wrap subform-table">
        <table>
          <thead><tr><th>Program</th><th>Dates</th><th>Teacher</th><th>Hall</th><th>Status</th></tr></thead>
          <tbody>
            ${conducted.length ? conducted.map((course) => `
              <tr>
                <td><button class="text-link-button" type="button" data-course-open="${course.id}">${course.name}</button></td>
                <td>${course.start}<br><span class="muted">${course.end}</span></td>
                <td>${teacherByName(course.teacher) ? `<button class="text-link-button" type="button" data-linked-teacher="${teacherByName(course.teacher).id}">${course.teacher}</button>` : course.teacher}</td>
                <td>${course.hall}</td>
                <td><span class="pill ${statusClass(course.status || programLifecycleStatus(course))}">${course.status || programLifecycleStatus(course)}</span></td>
              </tr>
            `).join("") : `<tr><td colspan="5"><span class="muted">No programs conducted for this course yet.</span></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderTeachers() {
  const teacher = currentTeacher();
  const teachers = currentSession.role === "teacher"
    ? (teacher ? [teacher] : [])
    : assignableTeachers();
  if (!selectedTeacherId || !teachers.some((teacher) => teacher.id === selectedTeacherId)) {
    selectedTeacherId = teachers[0]?.id || "";
  }
  const layout = document.querySelector(".teachers-master-layout");
  if (layout) layout.classList.toggle("detail-open", openDetailView.teachers);
  const columns = [
    { key: "name", label: "Teacher", value: (teacher) => teacherDisplayName(teacher) },
    { key: "speciality", label: "Speciality", value: (teacher) => teacher.speciality },
    { key: "contact", label: "Contact", value: (teacher) => `${teacher.phone} ${teacher.contactNumber} ${teacher.email}` },
    { key: "programs", label: "Programs", value: (teacher) => state.courses.filter((course) => course.teacher === teacherDisplayName(teacher) || course.teacher === teacher.name).length },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  ensureTableChrome("teacherRows", "teachers", columns);
  const result = tableRows("teachers", teachers, columns, {
    name: (a, b) => teacherDisplayName(a).localeCompare(teacherDisplayName(b)),
    speciality: (a, b) => a.speciality.localeCompare(b.speciality),
    contact: (a, b) => a.email.localeCompare(b.email),
    programs: (a, b) => state.courses.filter((course) => course.teacher === teacherDisplayName(a) || course.teacher === a.name).length - state.courses.filter((course) => course.teacher === teacherDisplayName(b) || course.teacher === b.name).length
  });
  $("#teacherRows").innerHTML = result.rows.map((teacher) => {
    const displayName = teacherDisplayName(teacher);
    const programs = state.courses.filter((course) => course.teacher === displayName || course.teacher === teacher.name);
    return `
      <tr class="teacher-master-row ${teacher.id === selectedTeacherId ? "participant-row-selected" : ""}" data-teacher-view="${teacher.id}" tabindex="0">
        ${renderSelectionCell("teachers", teacher.id)}
        <td><strong>${displayName}</strong><br><span class="muted">${teacher.email}</span></td>
        <td>${teacher.speciality}</td>
        <td>${teacher.phone || "No phone"}<br><span class="muted">${teacher.email || "No email"}${teacher.contactNumber ? ` | ${teacher.contactNumber}` : ""}</span></td>
        <td>${programs.length ? programs.map((course) => `<span class="pill">${course.name}</span>`).join(" ") : "<span class=\"muted\">No programs assigned</span>"}</td>
        <td>
          ${canEditTeacher(teacher.id) ? `<div class="row-actions">
            <button class="secondary-button" type="button" data-teacher-edit="${teacher.id}">Edit Profile</button>
          </div>` : "<span class=\"muted\">View only</span>"}
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="${canManageMasters() ? 6 : 5}"><span class="muted">No teachers found.</span></td></tr>`;
  renderTablePagination("teachers", result);
  const selected = teachers.find((teacher) => teacher.id === selectedTeacherId);
  if (!selected) {
    $("#teacherDetail").innerHTML = `<p class="muted">No teachers recorded yet.</p>`;
    return;
  }
  const selectedDisplayName = teacherDisplayName(selected);
  const mappedCourses = coursesMappedToTeacher(selected);
  const conducted = state.courses.filter((course) => course.teacher === selectedDisplayName || course.teacher === selected.name);
  $("#teacherDetail").innerHTML = `
    ${backLinkHtml()}
    <div class="profile-card">
      <img class="profile-photo" src="${teacherPhoto(selected)}" alt="${selectedDisplayName} profile photo">
      <div class="profile-summary">
        <div class="participant-detail-heading">
          <div>
            <h3>${selectedDisplayName}</h3>
            <p class="muted">${[selected.email, selected.phone, selected.contactNumber].filter(Boolean).join(" | ") || "Contact details not captured"}</p>
          </div>
          ${canEditTeacher(selected.id) ? `<button class="secondary-button" type="button" data-teacher-edit="${selected.id}">Edit Profile</button>` : ""}
          <span class="pill">${conducted.length} program(s)</span>
        </div>
        <div class="profile-meta">
          <span>${selected.speciality}</span>
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-item"><span>Title</span><strong>${selected.title || "No title"}</strong></div>
      <div class="detail-item"><span>First Name</span><strong>${selected.firstName || "Not captured"}</strong></div>
      <div class="detail-item"><span>Last Name</span><strong>${selected.lastName || "Not captured"}</strong></div>
      <div class="detail-item"><span>Phone</span><strong>${selected.phone}</strong></div>
      <div class="detail-item"><span>Email</span><strong>${selected.email}</strong></div>
      <div class="detail-item"><span>Contact Number</span><strong>${selected.contactNumber || "Not captured"}</strong></div>
      <div class="detail-item"><span>Gender</span><strong>${selected.gender || "Not specified"}</strong></div>
      <div class="detail-item"><span>Marital Status</span><strong>${selected.maritalStatus || "Not specified"}</strong></div>
      <div class="detail-item detail-item-wide"><span>Educational Qualifications</span><strong>${selected.education || "Not captured"}</strong></div>
      <div class="detail-item detail-item-wide"><span>Notes</span><strong>${selected.notes || "No notes recorded."}</strong></div>
    </div>
    <section class="participant-subform">
      <div class="subform-header">
        <h3>Courses Mapped</h3>
        <span class="muted">${mappedCourses.length} course(s)</span>
      </div>
      <div class="table-wrap subform-table">
        <table>
          <thead>
            <tr>
              <th>Course</th>
              <th>Hierarchy</th>
              <th>Duration</th>
              <th>Programs</th>
            </tr>
          </thead>
          <tbody>
            ${mappedCourses.length ? mappedCourses.map((program) => `
              <tr>
                <td><button class="text-link-button" type="button" data-linked-program="${program.id}">${program.name}</button><br><span class="muted">${program.code || "No code"} | ${program.level || "No level"}</span></td>
                <td>${courseMasterLabel(program)}</td>
                <td>${program.duration || "Not set"}</td>
                <td>${conductedProgramsForCourse(program).length}</td>
              </tr>
            `).join("") : `<tr><td colspan="4"><span class="muted">No courses mapped to this teacher yet.</span></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
    <section class="participant-subform">
      <div class="subform-header">
        <h3>Programs Conducted</h3>
        <span class="muted">${conducted.length} record(s)</span>
      </div>
      <div class="table-wrap subform-table">
        <table>
          <thead>
            <tr>
              <th>Program</th>
              <th>Dates</th>
              <th>Hall</th>
              <th>Participants</th>
            </tr>
          </thead>
          <tbody>
            ${conducted.length ? conducted.map((course) => `
              <tr>
                <td><button class="text-link-button" type="button" data-linked-batch="${course.id}">${course.name}</button></td>
                <td>${course.start}<br>${course.end}</td>
                <td>${course.hall}</td>
                <td>${registrationRowsForCourse(course.id).length}/${course.seats}</td>
              </tr>
            `).join("") : `<tr><td colspan="4"><span class="muted">No programs conducted yet.</span></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderParticipantsMaster() {
  const participants = visibleParticipants();
  if (!selectedParticipantId || !participants.some((participant) => participant.id === selectedParticipantId)) {
    selectedParticipantId = participants[0]?.id || "";
  }
  const layout = document.querySelector(".participants-master-layout");
  if (layout) layout.classList.toggle("detail-open", openDetailView.participants);
  const columns = [
    { key: "name", label: "Participant", value: (participant) => participant.name },
    { key: "program", label: "Program", value: (participant) => courseName(currentRegistration(participant).courseId) },
    { key: "completion", label: "Completion", value: (participant) => currentRegistration(participant).completion },
    { key: "accommodation", label: "Accommodation", value: (participant) => roomName(currentRegistration(participant).roomId) }
  ];
  ensureTableChrome("participantMasterRows", "participants", columns);
  const result = tableRows("participants", participants, columns, {
    name: (a, b) => a.name.localeCompare(b.name),
    program: (a, b) => courseName(currentRegistration(a).courseId).localeCompare(courseName(currentRegistration(b).courseId)),
    completion: (a, b) => currentRegistration(a).completion.localeCompare(currentRegistration(b).completion),
    accommodation: (a, b) => roomName(currentRegistration(a).roomId).localeCompare(roomName(currentRegistration(b).roomId))
  });
  $("#participantMasterRows").innerHTML = result.rows.map((participant) => {
    const registration = currentRegistration(participant);
    const batch = batchForParticipant(participant);
    const courseMaster = courseMasterForBatch(batch);
    const registrationCount = registrationsForParticipant(participant).length;
    return `
      <tr class="participant-master-row ${participant.id === selectedParticipantId ? "participant-row-selected" : ""}" data-participant-view="${participant.id}" tabindex="0">
        <td><strong>${participant.name}</strong><br><span class="muted">${participant.age}, ${participant.gender} | ${participant.phone} | ${registrationCount} registration(s)</span></td>
        <td>${courseName(participant.courseId)}<br><span class="muted">${courseMaster?.name || "Course master not mapped"}</span></td>
        <td><span class="pill ${statusClass(registration.completion)}">${registration.completion}</span><br><span class="muted">${registration.attendance} sessions | ${registration.certificate ? "Certificate issued" : "Certificate pending"}</span></td>
        <td>${roomName(registration.roomId)}<br><span class="muted">${registration.checkedIn ? "Checked in" : "Not checked in"}</span></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="4"><span class="muted">No participants found.</span></td></tr>`;
  renderTablePagination("participants", result);

  const selected = participants.find((participant) => participant.id === selectedParticipantId);
  if (!selected) {
    $("#participantDetail").innerHTML = `<p class="muted">No participants recorded yet.</p>`;
    return;
  }
  const programsAttended = participantProgramHistory(selected);
  $("#participantDetail").innerHTML = `
    <button class="secondary-button link-back-button" type="button" data-record-back="participants">Back to Participants</button>
    ${backLinkHtml()}
    <div class="profile-card">
      <img class="profile-photo" src="${participantPhoto(selected)}" alt="${selected.name} profile photo">
      <div class="profile-summary">
        <div class="participant-detail-heading">
          <div>
            <h3>${selected.name}</h3>
            <p class="muted">${selected.email} | ${selected.phone}</p>
          </div>
          ${canEditParticipant(selected.id) ? `<button class="secondary-button" type="button" data-participant-edit="${selected.id}">Edit Personal Details</button>` : ""}
        </div>
        <div class="profile-meta">
          <span>${selected.age} years</span>
          <span>${selected.gender}</span>
          <span>${registrationsForParticipant(selected).length} registration(s)</span>
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-item"><span>Participant</span><strong>${selected.age} years | ${selected.gender}</strong></div>
      <div class="detail-item"><span>Phone</span><strong>${selected.phone}</strong></div>
      <div class="detail-item"><span>Email</span><strong>${selected.email}</strong></div>
      <div class="detail-item"><span>Emergency Contact</span><strong>${selected.emergencyContact || "Not recorded"}</strong></div>
      <div class="detail-item"><span>Address</span><strong>${selected.address || "Not recorded"}</strong></div>
      <div class="detail-item detail-item-wide"><span>Notes</span><strong>${selected.notes || "No special notes recorded."}</strong></div>
    </div>
    <section class="participant-subform">
      <div class="subform-header">
        <h3>Programs Attended</h3>
        <span class="muted">${programsAttended.length} record(s)</span>
      </div>
      <div class="table-wrap subform-table">
        <table>
          <thead>
            <tr>
              <th>Course</th>
              <th>Program</th>
              <th>Dates</th>
              <th>Registration</th>
              <th>Payment</th>
              <th>Completion</th>
              <th>Attendance</th>
              <th>Accommodation</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            ${programsAttended.map((program) => `
              <tr>
                <td>${program.programName || "Not mapped"}</td>
                <td>${program.courseId ? `<button class="text-link-button" type="button" data-linked-batch="${program.courseId}">${program.batchName}</button>` : program.batchName}</td>
                <td>${program.start && program.end ? `${program.start}<br>${program.end}` : "Not scheduled"}</td>
                <td><span class="pill ${statusClass(program.status || "Pending")}">${program.status || "Pending"}</span><br><span class="muted">${program.eligible ? "Eligibility verified" : "Eligibility needs review"}</span></td>
                <td>${program.paymentStatus || "Enquiry"}<br><span class="muted">${program.pricingCategory || "General"} | ${Number(program.amount) || 0}</span></td>
                <td><span class="pill ${statusClass(program.completion || "In Progress")}">${program.completion || "In Progress"}</span><br><span class="muted">${program.certificate ? "Certificate issued" : "Certificate pending"}</span></td>
                <td>${program.attendance || 0} sessions</td>
                <td>${program.accommodationType || "Not Required"}<br><span class="muted">${program.accommodation || "Not assigned"}${program.roomType ? ` | ${program.roomType}` : ""}<br>${program.stayStart || "No check-in"} to ${program.stayEnd || "No check-out"} | ${program.stayStatus || "Not checked in"}</span></td>
                <td>${program.notes || "No notes"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRegistrations() {
  let rows = visibleRegistrationRows().filter(({ registration }) => currentFilter === "all" || registration.status === currentFilter);
  const columns = [
    { key: "name", label: "Name", value: ({ participant }) => participant.name },
    { key: "program", label: "Program", value: ({ registration }) => courseName(registration.courseId) },
    { key: "status", label: "Status", value: ({ registration }) => registration.status },
    { key: "payment", label: "Payment", value: ({ registration }) => `${normalizePaymentStatus(registration.paymentStatus)} ${registration.pricingCategory || ""} ${Number(registration.amount) || 0}` },
    { key: "eligible", label: "Eligibility", value: ({ registration }) => registration.eligible ? "Verified" : "Needs review" },
    { key: "room", label: "Accommodation", value: ({ registration }) => `${normalizeAccommodationType(registration.accommodationType)} ${roomName(registration.roomId)}` },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  ensureTableChrome("participantRows", "registrations", columns);
  const result = tableRows("registrations", rows, columns, {
    name: (a, b) => a.participant.name.localeCompare(b.participant.name),
    program: (a, b) => courseName(a.registration.courseId).localeCompare(courseName(b.registration.courseId)),
    status: (a, b) => a.registration.status.localeCompare(b.registration.status),
    payment: (a, b) => `${normalizePaymentStatus(a.registration.paymentStatus)} ${a.registration.pricingCategory || ""}`.localeCompare(`${normalizePaymentStatus(b.registration.paymentStatus)} ${b.registration.pricingCategory || ""}`),
    eligible: (a, b) => Number(a.registration.eligible) - Number(b.registration.eligible),
    room: (a, b) => `${normalizeAccommodationType(a.registration.accommodationType)} ${roomName(a.registration.roomId)}`.localeCompare(`${normalizeAccommodationType(b.registration.accommodationType)} ${roomName(b.registration.roomId)}`)
  });
  const showActions = canReviewRegistrations();
  const groupedRows = result.rows.reduce((groups, row) => {
    const key = row.registration.courseId || "unassigned";
    let group = groups.find((item) => item.key === key);
    if (!group) {
      group = { key, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
    return groups;
  }, []);
  $("#participantRows").innerHTML = groupedRows.map((group) => {
    const course = state.courses.find((item) => item.id === group.key);
    const programTitle = course ? `<button class="text-link-button" type="button" data-linked-batch="${course.id}">${course.name}</button>` : "Unassigned Program";
    const programMeta = course ? `${course.start || "No start date"} to ${course.end || "No end date"} | ${group.rows.length} registration(s)` : `${group.rows.length} registration(s)`;
    return `
      <tr class="registration-group-row">
        <td colspan="${canManageMasters() ? 8 : 7}">
          <div>
            <strong>${programTitle}</strong>
            <span>${programMeta}</span>
          </div>
        </td>
      </tr>
      ${group.rows.map(({ participant, registration }) => {
    const contactLine = [participant.phone, participant.email].filter(Boolean).join(" | ") || "Contact not captured";
    return `
      <tr>
        ${renderSelectionCell("registrations", registration.id)}
        <td><strong><button class="text-link-button" type="button" data-linked-participant="${participant.id}">${participant.name}</button></strong><br><span class="muted">${contactLine}</span></td>
        <td><button class="text-link-button" type="button" data-linked-batch="${registration.courseId}">${courseName(registration.courseId)}</button><br><span class="muted">${registration.registeredOn || "Registration date not set"}</span></td>
        <td><span class="pill ${statusClass(registration.status)}">${registration.status}</span></td>
        <td>${normalizePaymentStatus(registration.paymentStatus)}<br><span class="muted">${registration.pricingCategory || "General"} | ${Number(registration.amount) || 0}</span></td>
        <td>${registration.eligible ? "Verified" : "Needs review"}</td>
        <td>${normalizeAccommodationType(registration.accommodationType)}<br><span class="muted">${roomName(registration.roomId)} | ${stayDateRange(registration).start || "No check-in"} to ${stayDateRange(registration).end || "No check-out"}</span></td>
        <td>
          ${!showActions ? "<span class=\"muted\">No further actions</span>" : `
            <div class="row-actions">
              ${!["Cancelled", "Dropout"].includes(registration.status) ? `
                <button class="secondary-button" type="button" data-action="eligible" data-id="${participant.id}" data-registration-id="${registration.id}">Verify</button>
                <button class="secondary-button" type="button" data-action="paid" data-id="${participant.id}" data-registration-id="${registration.id}">Mark Paid</button>
                <button class="secondary-button" type="button" data-action="approve" data-id="${participant.id}" data-registration-id="${registration.id}">Approve</button>
                <button class="secondary-button" type="button" data-action="confirm" data-id="${participant.id}" data-registration-id="${registration.id}">Confirm</button>
                <button class="secondary-button" type="button" data-action="waitlist" data-id="${participant.id}" data-registration-id="${registration.id}">Waitlist</button>
                <button class="danger-button" type="button" data-action="cancel" data-id="${participant.id}" data-registration-id="${registration.id}">Cancel</button>
              ` : `<span class="muted">${registration.status}</span>`}
            </div>
          `}
        </td>
      </tr>
    `;
      }).join("")}
    `;
  }).join("") || `<tr><td colspan="${canManageMasters() ? 8 : 7}"><span class="muted">No registrations found.</span></td></tr>`;
  renderTablePagination("registrations", result);
}

function renderRooms() {
  const blockColumns = [
    { key: "name", label: "Block", value: (block) => block.name },
    { key: "floors", label: "Floors", value: (block) => state.floors.filter((floor) => floor.blockId === block.id).length },
    { key: "rooms", label: "Rooms", value: (block) => state.rooms.filter((room) => room.blockId === block.id).length },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  const floorColumns = [
    { key: "name", label: "Floor", value: (floor) => floor.name },
    { key: "block", label: "Block", value: (floor) => blockName(floor.blockId) },
    { key: "rooms", label: "Rooms", value: (floor) => state.rooms.filter((room) => room.floorId === floor.id).length },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  const roomColumns = [
    { key: "name", label: "Room", value: (room) => room.name },
    { key: "block", label: "Block", value: (room) => blockName(room.blockId) },
    { key: "floor", label: "Floor", value: (room) => floorName(room.floorId) },
    { key: "gender", label: "Type", value: (room) => room.gender },
    { key: "status", label: "Status", value: (room) => normalizeRoomStatus(room.status) },
    { key: "beds", label: "Occupancy", value: (room) => Number(room.beds) },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  const blockResult = tableRows("accommodation-blocks", state.blocks, blockColumns, {
    name: (a, b) => a.name.localeCompare(b.name),
    floors: (a, b) => state.floors.filter((floor) => floor.blockId === a.id).length - state.floors.filter((floor) => floor.blockId === b.id).length,
    rooms: (a, b) => state.rooms.filter((room) => room.blockId === a.id).length - state.rooms.filter((room) => room.blockId === b.id).length
  });
  const blockRows = blockResult.rows.map((block) => {
    const floors = state.floors.filter((floor) => floor.blockId === block.id).length;
    const rooms = state.rooms.filter((room) => room.blockId === block.id).length;
    return `<tr>
      ${renderSelectionCell("accommodation-blocks", block.id)}
      <td><strong>${block.name}</strong><br><span class="muted">${block.notes || "No notes"}</span></td>
      <td>${floors}</td>
      <td>${rooms}</td>
      <td><div class="row-actions"><button class="secondary-button" type="button" data-block-edit="${block.id}">Edit</button><button class="danger-button" type="button" data-block-delete="${block.id}">Delete</button></div></td>
    </tr>`;
  }).join("");
  const floorResult = tableRows("accommodation-floors", state.floors, floorColumns, {
    name: (a, b) => a.name.localeCompare(b.name),
    block: (a, b) => blockName(a.blockId).localeCompare(blockName(b.blockId)),
    rooms: (a, b) => state.rooms.filter((room) => room.floorId === a.id).length - state.rooms.filter((room) => room.floorId === b.id).length
  });
  const floorRows = floorResult.rows.map((floor) => `
    <tr>
      ${renderSelectionCell("accommodation-floors", floor.id)}
      <td><strong>${floor.name}</strong></td>
      <td>${blockName(floor.blockId)}</td>
      <td>${state.rooms.filter((room) => room.floorId === floor.id).length}</td>
      <td><div class="row-actions"><button class="secondary-button" type="button" data-floor-edit="${floor.id}">Edit</button><button class="danger-button" type="button" data-floor-delete="${floor.id}">Delete</button></div></td>
    </tr>
  `).join("");
  const roomResult = tableRows("accommodation-rooms", state.rooms, roomColumns, {
    name: (a, b) => a.name.localeCompare(b.name),
    block: (a, b) => blockName(a.blockId).localeCompare(blockName(b.blockId)),
    floor: (a, b) => floorName(a.floorId).localeCompare(floorName(b.floorId)),
    gender: (a, b) => a.gender.localeCompare(b.gender),
    status: (a, b) => normalizeRoomStatus(a.status).localeCompare(normalizeRoomStatus(b.status)),
    beds: (a, b) => Number(a.beds) - Number(b.beds)
  });
  const roomRows = roomResult.rows.map((room) => {
    const guests = state.participants.filter((p) => currentRegistration(p)?.roomId === room.id);
    const percent = Math.round((guests.length / room.beds) * 100);
    return `<tr>
      ${renderSelectionCell("accommodation-rooms", room.id)}
      <td><strong>${room.name}</strong><br><span class="muted">${guests.length ? guests.map((guest) => guest.name).join(", ") : "No guests assigned"}</span></td>
      <td>${blockName(room.blockId)}</td>
      <td>${floorName(room.floorId)}</td>
      <td>${room.gender}</td>
      <td><span class="pill ${isRoomClean(room) ? "confirmed" : "pending"}">${normalizeRoomStatus(room.status)}</span><br><span class="muted">${room.cleaningNotes || ""}</span></td>
      <td>${guests.length}/${room.beds}<div class="bed-bar compact-bed-bar"><span style="width:${Math.min(percent, 100)}%"></span></div></td>
      <td><div class="row-actions"><button class="secondary-button" type="button" data-room-edit="${room.id}">Edit</button><button class="danger-button" type="button" data-room-delete="${room.id}">Delete</button></div></td>
    </tr>`;
  }).join("");
  const contentByTab = {
    blocks: `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Block</th><th>Floors</th><th>Rooms</th><th>Actions</th></tr></thead>
          <tbody id="accommodationBlockRows">${blockRows}</tbody>
        </table>
      </div>
    `,
    floors: `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Floor</th><th>Block</th><th>Rooms</th><th>Actions</th></tr></thead>
          <tbody id="accommodationFloorRows">${floorRows}</tbody>
        </table>
      </div>
    `,
    rooms: `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Room</th><th>Block</th><th>Floor</th><th>Type</th><th>Status</th><th>Occupancy</th><th>Actions</th></tr></thead>
          <tbody id="accommodationRoomRows">${roomRows}</tbody>
        </table>
      </div>
    `
  };
  $("#accommodationContent").innerHTML = contentByTab[accommodationTab] || contentByTab.blocks;
  ensureTableChrome("accommodationBlockRows", "accommodation-blocks", blockColumns);
  ensureTableChrome("accommodationFloorRows", "accommodation-floors", floorColumns);
  ensureTableChrome("accommodationRoomRows", "accommodation-rooms", roomColumns);
  renderTablePagination("accommodation-blocks", blockResult);
  renderTablePagination("accommodation-floors", floorResult);
  renderTablePagination("accommodation-rooms", roomResult);
  $$("#accommodationTabs button").forEach((button) => button.classList.toggle("is-selected", button.dataset.accommodationTab === accommodationTab));
  const addButton = $("#addAccommodationRecord");
  if (addButton) {
    addButton.hidden = false;
    addButton.textContent = {
      blocks: "Add Block",
      floors: "Add Floor",
      rooms: "Add Room"
    }[accommodationTab] || "Add Record";
  }
}

function renderRoomAllotments() {
  if (!roomAvailabilityFilter.start || !roomAvailabilityFilter.end) {
    const nextStay = allRegistrationRows()
      .map(({ registration }) => stayDateRange(registration))
      .filter((stay) => stay.start && stay.end)
      .sort((a, b) => a.start.localeCompare(b.start))[0];
    roomAvailabilityFilter = {
      ...roomAvailabilityFilter,
      start: roomAvailabilityFilter.start || nextStay?.start || new Date().toISOString().slice(0, 10),
      end: roomAvailabilityFilter.end || nextStay?.end || new Date().toISOString().slice(0, 10)
    };
  }
  const allotmentRegistrations = allRegistrationRows()
    .filter(({ registration }) => registration.status === "Confirmed" && normalizeAccommodationType(registration.accommodationType) !== "Not Required")
    .sort((a, b) => {
      const firstStay = stayDateRange(a.registration);
      const secondStay = stayDateRange(b.registration);
      return firstStay.start.localeCompare(secondStay.start) || courseName(a.registration.courseId).localeCompare(courseName(b.registration.courseId)) || a.participant.name.localeCompare(b.participant.name);
    });
  const rows = allotmentRegistrations.map(({ participant, registration }) => {
    const course = courseForRegistration(registration);
    const stay = stayDateRange(registration);
    const assignedRoom = state.rooms.find((room) => room.id === registration.roomId);
    const matchingRooms = roomsForAccommodationType(registration.accommodationType);
    const roomOptions = [
      `<option value="">Not allotted</option>`,
      ...matchingRooms.map((room) => {
        const occupied = roomOccupancyForDateRange(room.id, stay.start, stay.end, registration.id);
        const isSelected = room.id === registration.roomId;
        const unavailable = availableBedsForDateRange(room, stay.start, stay.end, registration.id) <= 0 && !isSelected;
        const statusText = isRoomClean(room) ? `${occupied}/${room.beds}` : normalizeRoomStatus(room);
        return `<option value="${room.id}" ${isSelected ? "selected" : ""} ${unavailable ? "disabled" : ""}>${room.name} - ${blockName(room.blockId)} / ${floorName(room.floorId)} (${statusText})</option>`;
      })
    ].join("");
    const status = assignedRoom
      ? `<span class="pill confirmed">Allotted</span><br><span class="muted">${registration.checkedOut ? "Checked out" : registration.checkedIn ? "Checked in" : "Awaiting check-in"}</span>`
      : `<span class="pill pending">Pending</span>`;
    const stayActions = assignedRoom ? `
      <div class="row-actions">
        <button class="secondary-button" type="button" data-room-stay-action="checkin" data-id="${participant.id}" data-registration-id="${registration.id}">Check In</button>
        <button class="secondary-button" type="button" data-room-stay-action="checkout" data-id="${participant.id}" data-registration-id="${registration.id}">Check Out</button>
      </div>
    ` : "";
    return `<tr>
      <td><strong><button class="text-link-button" type="button" data-linked-participant="${participant.id}">${participant.name}</button></strong><br><span class="muted">${participant.phone || participant.email || "Contact not captured"}</span></td>
      <td>${course ? `<button class="text-link-button" type="button" data-linked-batch="${course.id}">${course.name}</button>` : "Program not found"}<br><span class="muted">${course ? `${course.start} to ${course.end}` : "Program dates missing"}</span></td>
      <td><input type="date" value="${stay.start}" data-stay-date="${participant.id}" data-registration-id="${registration.id}" data-stay-field="checkinDate"></td>
      <td><input type="date" value="${stay.end}" data-stay-date="${participant.id}" data-registration-id="${registration.id}" data-stay-field="checkoutDate"></td>
      <td>${normalizeAccommodationType(registration.accommodationType)}<br><span class="muted">${assignedRoom ? assignedRoom.name : "Not allotted"}</span></td>
      <td><select data-room-allotment="${participant.id}" data-registration-id="${registration.id}">${roomOptions}</select></td>
      <td>${status}${stayActions}</td>
    </tr>`;
  }).join("");
  const availabilityRooms = state.rooms.filter((room) => roomAvailabilityFilter.type === "All" || normalizeRoomType(room.gender) === roomAvailabilityFilter.type);
  const availabilityRows = availabilityRooms.map((room) => {
    const occupied = roomOccupancyForDateRange(room.id, roomAvailabilityFilter.start, roomAvailabilityFilter.end);
    const available = availableBedsForDateRange(room, roomAvailabilityFilter.start, roomAvailabilityFilter.end);
    const overlaps = allRegistrationRows()
      .filter(({ registration }) => registration.status === "Confirmed" && registration.roomId === room.id)
      .filter(({ registration }) => !registration.checkedOut)
      .filter(({ registration }) => {
        const stay = stayDateRange(registration);
        return dateRangesOverlap(roomAvailabilityFilter.start, roomAvailabilityFilter.end, stay.start, stay.end);
      })
      .sort((a, b) => stayDateRange(a.registration).start.localeCompare(stayDateRange(b.registration).start));
    const upcomingStays = overlaps.slice(0, 4).map(({ participant, registration }) => {
      const stay = stayDateRange(registration);
      return `${participant.name} (${stay.start} to ${stay.end})`;
    });
    return `<tr>
      <td><strong>${room.name}</strong><br><span class="muted">${blockName(room.blockId)} / ${floorName(room.floorId)}</span></td>
      <td>${normalizeRoomType(room.gender)}</td>
      <td><span class="pill ${isRoomClean(room) ? "confirmed" : "pending"}">${normalizeRoomStatus(room.status)}</span><br><span class="muted">${room.cleaningNotes || ""}</span></td>
      <td>${available}/${room.beds}<br><span class="muted">${occupied} occupied in range</span></td>
      <td>${overlaps.length ? upcomingStays.join("<br>") : "<span class=\"muted\">No occupied stays in range</span>"}</td>
      <td>${!isRoomClean(room) ? `<button class="secondary-button" type="button" data-room-clean="${room.id}">Mark Clean</button>` : ""}</td>
    </tr>`;
  }).join("");
  const dirtyRows = state.rooms
    .filter((room) => !isRoomClean(room))
    .map((room) => `<tr>
      <td><strong>${room.name}</strong><br><span class="muted">${blockName(room.blockId)} / ${floorName(room.floorId)}</span></td>
      <td><span class="pill pending">${normalizeRoomStatus(room.status)}</span></td>
      <td>${room.cleaningNotes || "Needs cleaning update"}</td>
      <td><button class="secondary-button" type="button" data-room-clean="${room.id}">Mark Clean</button></td>
    </tr>`).join("");
  const programReadinessRows = state.courses
    .filter((course) => dateFromInput(course.end) && dateFromInput(course.end) >= dateFromInput(new Date().toISOString().slice(0, 10)))
    .sort((a, b) => dateFromInput(a.start) - dateFromInput(b.start))
    .slice(0, 8)
    .map((course) => {
      const required = allRegistrationRows().filter(({ registration }) => registration.courseId === course.id && registration.status === "Confirmed" && normalizeAccommodationType(registration.accommodationType) !== "Not Required").length;
      const available = totalAvailableBedsForDateRange(course.start, course.end);
      return `<tr>
        <td><button class="text-link-button" type="button" data-linked-batch="${course.id}">${course.name}</button><br><span class="muted">${course.start} to ${course.end}</span></td>
        <td>${required}</td>
        <td>${available}</td>
        <td><span class="pill ${available >= required ? "confirmed" : "pending"}">${available >= required ? "Rooms Available" : "Room Shortage"}</span></td>
      </tr>`;
    }).join("");
  $("#roomAllotmentContent").innerHTML = `
    <div class="stack">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Allot Rooms</h2>
            <span class="muted">Confirmed registrations with accommodation request</span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Participant</th><th>Program</th><th>Check-In</th><th>Check-Out</th><th>Request</th><th>Room</th><th>Status</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="7"><span class="muted">No confirmed registrations need room allotment.</span></td></tr>`}</tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Available Rooms List</h2>
            <span class="muted">Only clean rooms with free beds are available for check-in</span>
          </div>
        </div>
        <div class="form-grid compact-form-grid">
          <label>Check-In<input type="date" data-room-availability-filter="start" value="${roomAvailabilityFilter.start}"></label>
          <label>Check-Out<input type="date" data-room-availability-filter="end" value="${roomAvailabilityFilter.end}"></label>
          <label>Type
            <select data-room-availability-filter="type">
              ${["All", ...roomTypes].map((type) => `<option value="${type}" ${type === roomAvailabilityFilter.type ? "selected" : ""}>${type}</option>`).join("")}
            </select>
          </label>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Room</th><th>Type</th><th>Cleaning Status</th><th>Available Beds</th><th>Occupied Stays</th><th>Action</th></tr></thead>
            <tbody>${availabilityRows || `<tr><td colspan="6"><span class="muted">No rooms match this availability filter.</span></td></tr>`}</tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Dirty Rooms</h2>
            <span class="muted">Rooms checked out or marked unavailable for cleaning</span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Room</th><th>Status</th><th>Notes</th><th>Action</th></tr></thead>
            <tbody>${dirtyRows || `<tr><td colspan="4"><span class="muted">No dirty rooms.</span></td></tr>`}</tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Program Room Readiness</h2>
            <span class="muted">Upcoming programs checked against clean room availability</span>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Program</th><th>Required Rooms</th><th>Available Beds</th><th>Status</th></tr></thead>
            <tbody>${programReadinessRows || `<tr><td colspan="4"><span class="muted">No upcoming programs found.</span></td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderHalls() {
  const hallColumns = [
    { key: "name", label: "Hall", value: (hall) => hall.name },
    { key: "capacity", label: "Capacity", value: (hall) => Number(hall.capacity) },
    { key: "location", label: "Location", value: (hall) => hall.location },
    { key: "notes", label: "Notes", value: (hall) => hall.notes || "" },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  const bookingColumns = [
    { key: "program", label: "Program", value: (booking) => courseName(booking.courseId) },
    { key: "hall", label: "Hall", value: (booking) => hallName(booking.hallId) },
    { key: "start", label: "Dates", value: (booking) => `${booking.start} ${booking.end}` },
    { key: "notes", label: "Notes", value: (booking) => booking.notes || "" },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  const hallResult = tableRows("halls", state.halls, hallColumns, {
    name: (a, b) => a.name.localeCompare(b.name),
    capacity: (a, b) => Number(a.capacity) - Number(b.capacity),
    location: (a, b) => a.location.localeCompare(b.location),
    notes: (a, b) => (a.notes || "").localeCompare(b.notes || "")
  });
  const hallRows = hallResult.rows.map((hall) => `
    <tr>
      ${renderSelectionCell("halls", hall.id)}
      <td><strong>${hall.name}</strong></td>
      <td>${hall.capacity}</td>
      <td>${hall.location}</td>
      <td>${hall.notes || "<span class=\"muted\">No notes</span>"}</td>
      <td><div class="row-actions"><button class="secondary-button" type="button" data-hall-edit="${hall.id}">Edit</button><button class="danger-button" type="button" data-hall-delete="${hall.id}">Delete</button></div></td>
    </tr>
  `).join("");
  const bookingResult = tableRows("hall-bookings", state.hallBookings, bookingColumns, {
    program: (a, b) => courseName(a.courseId).localeCompare(courseName(b.courseId)),
    hall: (a, b) => hallName(a.hallId).localeCompare(hallName(b.hallId)),
    start: (a, b) => dateFromInput(a.start) - dateFromInput(b.start),
    notes: (a, b) => (a.notes || "").localeCompare(b.notes || "")
  });
  const bookingRows = bookingResult.rows.map((booking) => `
    <tr>
      ${renderSelectionCell("hall-bookings", booking.id)}
      <td><button class="text-link-button" type="button" data-linked-batch="${booking.courseId}">${courseName(booking.courseId)}</button></td>
      <td>${hallName(booking.hallId)}</td>
      <td>${booking.start}<br><span class="muted">${booking.end}</span></td>
      <td>${booking.notes || "<span class=\"muted\">No notes</span>"}</td>
      <td><div class="row-actions"><button class="secondary-button" type="button" data-hall-booking-edit="${booking.id}">Edit</button><button class="danger-button" type="button" data-hall-booking-delete="${booking.id}">Delete</button></div></td>
    </tr>
  `).join("");
  $("#hallContent").innerHTML = hallTab === "halls" ? `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hall</th>
            <th>Capacity</th>
            <th>Location</th>
            <th>Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="hallRows">${hallRows}</tbody>
      </table>
    </div>
  ` : `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Program</th>
            <th>Hall</th>
            <th>Dates</th>
            <th>Notes</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="hallBookingRows">${bookingRows}</tbody>
      </table>
    </div>
  `;
  ensureTableChrome("hallRows", "halls", hallColumns);
  ensureTableChrome("hallBookingRows", "hall-bookings", bookingColumns);
  renderTablePagination("halls", hallResult);
  renderTablePagination("hall-bookings", bookingResult);
  $$("#hallTabs button").forEach((button) => button.classList.toggle("is-selected", button.dataset.hallTab === hallTab));
}

function renderHallBookings() {
  renderHalls();
}

function renderAccessManagement() {
  if (!$("#accessUserRows")) return;
  const userColumns = [
    { key: "user", label: "User", value: (user) => `${user.display_name} ${user.login_email || ""}` },
    { key: "role", label: "Role", value: (user) => roleById(user.role_id)?.name || user.role_id },
    { key: "linked", label: "Linked Record", value: (user) => state.teachers.find((teacher) => teacher.id === user.linked_teacher_id)?.name || state.participants.find((participant) => participant.id === user.linked_participant_id)?.name || "" },
    { key: "status", label: "Status", value: (user) => user.active ? "Active" : "Inactive" },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  const roleColumns = [
    { key: "role", label: "Role", value: (role) => `${role.name} ${role.id}` },
    { key: "permissions", label: "Permissions", value: (role) => permissionsForRole(role).join(" ") || "View only" },
    { key: "status", label: "Status", value: (role) => role.active ? "Active" : "Inactive" },
    { key: "actions", label: "Actions", value: () => "", sort: false, filter: false }
  ];
  ensureTableChrome("accessUserRows", "access-users", userColumns);
  ensureTableChrome("accessRoleRows", "access-roles", roleColumns);
  const userResult = tableRows("access-users", accessUsers, userColumns, {
    user: (a, b) => a.display_name.localeCompare(b.display_name),
    role: (a, b) => (roleById(a.role_id)?.name || a.role_id).localeCompare(roleById(b.role_id)?.name || b.role_id),
    linked: (a, b) => userColumns[2].value(a).localeCompare(userColumns[2].value(b)),
    status: (a, b) => String(a.active).localeCompare(String(b.active))
  });
  $("#accessUserRows").innerHTML = userResult.rows.map((user) => {
    const role = roleById(user.role_id);
    const linkedTeacher = state.teachers.find((teacher) => teacher.id === user.linked_teacher_id);
    const linkedParticipant = state.participants.find((participant) => participant.id === user.linked_participant_id);
    const linkedRecord = linkedTeacher
      ? `<button class="text-link-button" type="button" data-linked-teacher="${linkedTeacher.id}">${linkedTeacher.name}</button>`
      : linkedParticipant
        ? `<button class="text-link-button" type="button" data-linked-participant="${linkedParticipant.id}">${linkedParticipant.name}</button>`
        : "<span class=\"muted\">Not linked</span>";
    return `
      <tr>
        ${renderSelectionCell("access-users", user.user_id)}
        <td><strong>${user.display_name}</strong><br><span class="muted">${user.login_email || user.user_id}</span></td>
        <td>${role?.name || user.role_id}<br><span class="muted">${user.role_id}</span></td>
        <td>${linkedRecord}</td>
        <td><span class="pill ${user.active ? "completed" : "dropout"}">${user.active ? "Active" : "Inactive"}</span></td>
        <td>
          <div class="row-actions">
            <button class="secondary-button" type="button" data-access-user-edit="${user.user_id}">Edit</button>
            <button class="danger-button" type="button" data-access-user-toggle="${user.user_id}">${user.active ? "Deactivate" : "Activate"}</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="5"><span class="muted">No app users configured yet.</span></td></tr>`;
  renderTablePagination("access-users", userResult);

  const roleResult = tableRows("access-roles", accessRoles, roleColumns, {
    role: (a, b) => a.name.localeCompare(b.name),
    permissions: (a, b) => permissionsForRole(a).join(" ").localeCompare(permissionsForRole(b).join(" ")),
    status: (a, b) => String(a.active).localeCompare(String(b.active))
  });
  $("#accessRoleRows").innerHTML = roleResult.rows.map((role) => {
    const permissions = permissionsForRole(role);
    const assigned = accessUsers.filter((user) => user.role_id === role.id).length;
    return `
      <tr>
        ${renderSelectionCell("access-roles", role.id)}
        <td><strong>${role.name}</strong><br><span class="muted">${role.id}${assigned ? ` | ${assigned} user(s)` : ""}</span></td>
        <td>
          <div class="permission-list">
            ${permissions.length ? permissions.map((permission) => `<span class="pill">${permission}</span>`).join("") : "<span class=\"muted\">View only</span>"}
          </div>
        </td>
        <td><span class="pill ${role.active ? "completed" : "dropout"}">${role.active ? "Active" : "Inactive"}</span></td>
        <td>
          <div class="row-actions">
            <button class="secondary-button" type="button" data-access-role-edit="${role.id}">Edit</button>
            <button class="danger-button" type="button" data-access-role-toggle="${role.id}">${role.active ? "Deactivate" : "Activate"}</button>
          </div>
        </td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="4"><span class="muted">No roles configured yet.</span></td></tr>`;
  renderTablePagination("access-roles", roleResult);

  $("#accessUserRoleSelect").innerHTML = accessRoles
    .filter((role) => role.active)
    .map((role) => `<option value="${role.id}">${role.name}</option>`)
    .join("");
  $("#accessUserTeacherSelect").innerHTML = `<option value="">No teacher link</option>${state.teachers.map((teacher) => `<option value="${teacher.id}">${teacherDisplayName(teacher)}</option>`).join("")}`;
  $("#accessUserParticipantSelect").innerHTML = `<option value="">No participant link</option>${state.participants.map((participant) => `<option value="${participant.id}">${participant.name}</option>`).join("")}`;
}

function renderCertificates() {
  $("#certificateList").innerHTML = visibleParticipants().map((p) => {
    const registration = currentRegistration(p);
    return `
    <article class="certificate-item">
      <div class="panel-header">
        <div>
          <strong>${p.name}</strong>
          <p class="muted">${courseName(registration?.courseId)} | ${registration?.completion}</p>
        </div>
        <span class="pill ${registration?.certificate ? "completed" : "pending"}">${registration?.certificate ? "Issued" : "Not issued"}</span>
      </div>
    </article>
  `;
  }).join("");
}

function renderHistory() {
  if (!$("#historyList")) return;
  $("#historyList").innerHTML = state.participants.map((p) => {
    const registration = currentRegistration(p);
    return `
    <article class="history-card">
      <div class="panel-header">
        <div>
          <h3>${p.name}</h3>
          <p class="muted">${p.email} | ${p.phone}</p>
        </div>
        <span class="pill ${statusClass(registration?.completion || "Pending")}">${registration?.completion || "Pending"}</span>
      </div>
      <p><strong>Program:</strong> ${courseName(registration?.courseId)}</p>
      <p><strong>Accommodation:</strong> ${roomName(registration?.roomId)}</p>
      <p><strong>Attendance:</strong> ${registration?.attendance || 0} sessions | <strong>Certificate:</strong> ${registration?.certificate ? "Issued" : "Pending"}</p>
      <p class="muted">${p.notes || "No special notes recorded."}</p>
    </article>
  `;
  }).join("");
}

function renderCourseOptions() {
  const registrationPrograms = state.courses.filter(isRegistrationProgram);
  $("#courseSelect").innerHTML = registrationPrograms.length
    ? registrationPrograms.map((course) => `<option value="${course.id}">${course.name} (${course.start} to ${course.end})</option>`).join("")
    : `<option value="">No scheduled programs available</option>`;
  $("#hallSelect").innerHTML = state.halls.length
    ? state.halls.map((hall) => `<option value="${hall.id}">${hall.name} (${hall.capacity})</option>`).join("")
    : `<option value="">No Program Halls available</option>`;
  const courseMasterOptions = state.programs.map((program) => {
    const label = courseMasterLabel(program);
    return `<option value="${program.id}">${label}${program.duration ? ` (${program.duration})` : ""}</option>`;
  }).join("");
  $("#batchProgramSelect").innerHTML = courseMasterOptions || `<option value="">No Course Master records available</option>`;
  renderBatchTeacherOptions();
  renderProgramTeacherOptions();
  renderRegistrationPricingOptions();
}

function renderRegistrationPricingOptions() {
  const select = $("#registrationPricingCategory");
  if (!select) return;
  const tiers = pricingTiersForCourse($("#courseSelect")?.value || "");
  select.innerHTML = tiers.map((tier) => `<option value="${tier.category}">${tier.category} - ${tier.amount}</option>`).join("");
  $$("#bulkRegistrantRows .bulk-registrant-row").forEach((row) => {
    const categorySelect = row.querySelector('[data-bulk-field="pricingCategory"]');
    if (!categorySelect) return;
    const selected = categorySelect.value;
    categorySelect.innerHTML = tiers.map((tier) => `<option value="${tier.category}" ${tier.category === selected ? "selected" : ""}>${tier.category} - ${tier.amount}</option>`).join("");
  });
}

function openCourseDialog(courseId = "") {
  const form = $("#courseForm");
  form.reset();
  form.elements.id.value = courseId;
  renderCourseOptions();
  if (courseId) {
    const course = state.courses.find((item) => item.id === courseId);
    if (!course) return;
    $("#courseDialogTitle").textContent = "Edit Program Schedule";
    form.elements.name.value = course.name;
    form.elements.programId.value = course.programId || "";
    form.elements.start.value = course.start;
    form.elements.end.value = course.end;
    form.elements.seats.value = course.seats;
    form.elements.hallId.value = course.hallId || "";
    form.elements.eligibility.value = course.eligibility || "";
    renderBatchTeacherOptions(course.teacher || "");
  } else {
    $("#courseDialogTitle").textContent = "Add Program Schedule";
    const firstCourseWithTeachers = state.programs.find((program) => teachersForProgram(program.id).length);
    if (firstCourseWithTeachers) {
      $("#batchProgramSelect").value = firstCourseWithTeachers.id;
    }
    renderBatchTeacherOptions();
  }
  $("#courseDialog").showModal();
}

function renderProgramParentOptions(currentId = "") {
  const options = state.programs
    .filter((program) => program.id !== currentId)
    .map((program) => `<option value="${program.id}">${program.name}</option>`)
    .join("");
  $("#programParentSelect").innerHTML = `<option value="">No parent / root course</option>${options}`;
}

function renderProgramTeacherOptions(selectedIds = []) {
  const selected = new Set(selectedIds);
  $("#programTeacherOptions").innerHTML = assignableTeachers().map((teacher) => `
    <label class="multi-select-option">
      <input type="checkbox" value="${teacher.id}" data-program-teacher-option ${selected.has(teacher.id) ? "checked" : ""}>
      <span>${teacherDisplayName(teacher)}${teacher.isVirtual ? " (active user)" : ""}</span>
    </label>
  `).join("") || `<span class="muted">No teachers available.</span>`;
  syncProgramTeacherSelection();
}

function syncProgramTeacherSelection() {
  const selectedIds = $$("[data-program-teacher-option]:checked").map((input) => input.value);
  $("#programTeacherIds").value = selectedIds.join(",");
  const names = selectedIds.map(teacherNameById).filter(Boolean);
  $("#programTeacherSummary").textContent = names.length ? `${names.length} selected: ${names.join(", ")}` : "Select teachers";
}

function renderBatchTeacherOptions(selectedTeacherName = "") {
  const programId = $("#batchProgramSelect")?.value || "";
  const teachers = teachersForProgram(programId);
  $("#batchTeacherSelect").innerHTML = teachers.length
    ? teachers.map((teacher) => {
      const name = teacherDisplayName(teacher);
      return `<option value="${name}" ${name === selectedTeacherName ? "selected" : ""}>${name}</option>`;
    }).join("")
    : `<option value="">No teachers associated with this course</option>`;
}

function renderAll() {
  applyProgramLifecycleStatuses();
  saveData();
  renderAuthState();
  renderPortal();
  renderPermissionChrome();
  renderMetrics();
  renderDashboard();
  renderPrograms();
  renderCourses();
  renderTeachers();
  renderParticipantsMaster();
  renderRegistrations();
  renderRooms();
  renderRoomAllotments();
  renderHalls();
  renderAccessManagement();
  renderCertificates();
  renderCourseOptions();
  renderProgramParentOptions();
}

function updateParticipant(id, updater, message) {
  const participant = state.participants.find((item) => item.id === id);
  if (!participant) return;
  const registration = currentRegistration(participant);
  updater(participant);
  if (registration) {
    registration.courseId = participant.courseId;
    registration.status = participant.status;
    registration.eligible = participant.eligible;
    registration.roomId = participant.roomId;
    registration.checkedIn = participant.checkedIn;
    registration.checkedOut = Boolean(participant.checkedOut);
    registration.checkinDate = participant.checkinDate || registration.checkinDate || "";
    registration.checkoutDate = participant.checkoutDate || registration.checkoutDate || "";
    registration.attendance = participant.attendance;
    registration.completion = participant.completion;
    registration.certificate = participant.certificate;
    registration.notes = participant.notes || registration.notes || "";
  }
  renderAll();
  showToast(message);
}

function updateRegistration(participantId, registrationId, updater, message) {
  const participant = state.participants.find((item) => item.id === participantId);
  if (!participant) return;
  const registration = registrationsForParticipant(participant).find((item) => item.id === registrationId);
  if (!registration) return;
  updater(registration);
  if (registration === currentRegistration(participant)) {
    syncParticipantFromRegistration(participant, registration);
  }
  renderAll();
  showToast(message);
}

function markSessionAttendance(participantId, registrationId, sessionId, status, reason = "") {
  if (!canMarkAttendance()) {
    showToast("Only Teachers and Admins can mark attendance.");
    return;
  }
  const participant = state.participants.find((item) => item.id === participantId);
  if (!participant) return;
  const registration = registrationsForParticipant(participant).find((item) => item.id === registrationId);
  if (!registration) return;
  const existing = attendanceForSession(registration, sessionId);
  if (!existing && hasEarlierSessionAbsence(registration, sessionId)) {
    showToast("Cannot mark further attendance after an absence.");
    return;
  }
  const needsReason = status === "Late" || status === "Absent";
  if (needsReason && !reason) {
    openAttendanceReasonDialog(participantId, registrationId, sessionId, status);
    return;
  }
  const normalizedReason = status === "Present" ? "" : reason;
  if (existing) {
    existing.status = status;
    existing.reason = normalizedReason;
  } else {
    registration.sessionAttendance.push({ sessionId, status, reason: normalizedReason });
  }
  if (status === "Absent") {
    const sessions = courseSessionPlan(registration.courseId);
    const absentIndex = sessions.findIndex((session) => session.id === sessionId);
    registration.sessionAttendance = registration.sessionAttendance.filter((item) => {
      const index = sessions.findIndex((session) => session.id === item.sessionId);
      return index >= 0 && index <= absentIndex;
    });
  }
  updateRegistrationCompletion(registration);
  if (registration === currentRegistration(participant)) {
    syncParticipantFromRegistration(participant, registration);
  }
  renderAll();
  showToast(`${status} marked for ${participant.name}.`);
}

function markSessionPresentForAll(courseId, sessionId) {
  if (!canMarkAttendance()) {
    showToast("Only Teachers and Admins can mark attendance.");
    return;
  }
  let marked = 0;
  let skipped = 0;
  registrationRowsForCourse(courseId).forEach(({ participant, registration }) => {
    if (hasEarlierSessionAbsence(registration, sessionId)) {
      skipped += 1;
      return;
    }
    const existing = attendanceForSession(registration, sessionId);
    if (existing?.status === "Late" || existing?.status === "Absent") {
      skipped += 1;
      return;
    }
    if (existing) {
      existing.status = "Present";
      existing.reason = "";
    } else {
      registration.sessionAttendance.push({ sessionId, status: "Present", reason: "" });
    }
    updateRegistrationCompletion(registration);
    if (registration === currentRegistration(participant)) {
      syncParticipantFromRegistration(participant, registration);
    }
    marked += 1;
  });
  renderAll();
  showToast(skipped ? `Marked ${marked} present. ${skipped} exception(s) unchanged.` : `Marked ${marked} present.`);
}

function allotRoomToRegistration(participantId, registrationId, roomId) {
  if (!canManageMasters()) return;
  const participant = state.participants.find((item) => item.id === participantId);
  if (!participant) return;
  const registration = registrationsForParticipant(participant).find((item) => item.id === registrationId);
  if (!registration) return;
  const room = state.rooms.find((item) => item.id === roomId);
  const stay = stayDateRange(registration);
  if (room && normalizeRoomType(room.gender) !== normalizeAccommodationType(registration.accommodationType)) {
    showToast("Selected room does not match the requested accommodation type.");
    renderRoomAllotments();
    return;
  }
  if (room && !isRoomClean(room) && registration.roomId !== room.id) {
    showToast("Selected room is not clean and cannot be allotted for check-in.");
    renderRoomAllotments();
    return;
  }
  if (room && availableBedsForDateRange(room, stay.start, stay.end, registration.id) <= 0 && registration.roomId !== room.id) {
    showToast("Selected room has no available beds for this date range.");
    renderRoomAllotments();
    return;
  }
  registration.roomId = roomId || "";
  if (registration === currentRegistration(participant)) syncParticipantFromRegistration(participant, registration);
  renderAll();
  showToast(room ? `Room allotted: ${room.name}` : "Room allotment cleared.");
}

function updateRoomStatus(roomId, status, notes = "") {
  const room = state.rooms.find((item) => item.id === roomId);
  if (!room) return;
  room.status = normalizeRoomStatus(status);
  room.cleaningNotes = notes;
}

function releaseAccommodationForRegistration(participant, registration, reason) {
  if (!registration?.roomId) return null;
  const room = state.rooms.find((item) => item.id === registration.roomId);
  const shouldClean = Boolean(registration.checkedIn) || reason === "Dropout";
  if (room && shouldClean) {
    updateRoomStatus(room.id, "Dirty", `${reason} by ${participant.name}. Cleaning required before next check-in.`);
  }
  registration.roomId = "";
  registration.checkedIn = false;
  registration.checkedOut = shouldClean;
  if (registration === currentRegistration(participant)) syncParticipantFromRegistration(participant, registration);
  return room;
}

function markRoomClean(roomId) {
  if (!canManageMasters()) return;
  updateRoomStatus(roomId, "Clean", "");
  renderAll();
  showToast("Room marked clean and available for check-in.");
}

function updateStayLifecycle(participantId, registrationId, action) {
  if (!canManageMasters()) return;
  const participant = state.participants.find((item) => item.id === participantId);
  if (!participant) return;
  const registration = registrationsForParticipant(participant).find((item) => item.id === registrationId);
  if (!registration) return;
  const room = state.rooms.find((item) => item.id === registration.roomId);
  if (!room) {
    showToast("Allot a room before check-in/check-out.");
    return;
  }
  if (action === "checkin") {
    if (!isRoomClean(room)) {
      showToast("Room must be clean before check-in.");
      return;
    }
    registration.checkedIn = true;
    registration.checkedOut = false;
    if (registration === currentRegistration(participant)) syncParticipantFromRegistration(participant, registration);
    renderAll();
    showToast("Participant checked in.");
    return;
  }
  if (action === "checkout") {
    registration.checkedIn = false;
    registration.checkedOut = true;
    updateRoomStatus(room.id, "Dirty", `Checked out by ${participant.name}. Cleaning required.`);
    if (registration === currentRegistration(participant)) syncParticipantFromRegistration(participant, registration);
    renderAll();
    showToast("Participant checked out. Room marked dirty for cleaning.");
  }
}

function updateRegistrationStayDate(participantId, registrationId, field, value) {
  if (!canManageMasters()) return;
  const participant = state.participants.find((item) => item.id === participantId);
  if (!participant) return;
  const registration = registrationsForParticipant(participant).find((item) => item.id === registrationId);
  if (!registration || !["checkinDate", "checkoutDate"].includes(field)) return;
  const nextStay = { ...stayDateRange(registration), [field === "checkinDate" ? "start" : "end"]: value };
  if (nextStay.start && nextStay.end && dateFromInput(nextStay.start) > dateFromInput(nextStay.end)) {
    showToast("Check-out date must be on or after check-in date.");
    renderRoomAllotments();
    return;
  }
  registration[field] = value;
  if (registration.roomId) {
    const room = state.rooms.find((item) => item.id === registration.roomId);
    if (room && availableBedsForDateRange(room, nextStay.start, nextStay.end, registration.id) <= 0) {
      registration.roomId = "";
      showToast("Stay dates changed. Room allotment cleared because of overlap.");
    }
  }
  if (registration === currentRegistration(participant)) syncParticipantFromRegistration(participant, registration);
  renderAll();
}

function openAttendanceReasonDialog(participantId, registrationId, sessionId, status) {
  const participant = state.participants.find((item) => item.id === participantId);
  const registration = participant ? registrationsForParticipant(participant).find((item) => item.id === registrationId) : null;
  const existingReason = registration ? attendanceForSession(registration, sessionId)?.reason || "" : "";
  const form = $("#attendanceReasonForm");
  form.reset();
  form.elements.participantId.value = participantId;
  form.elements.registrationId.value = registrationId;
  form.elements.sessionId.value = sessionId;
  form.elements.status.value = status;
  form.elements.reason.value = existingReason;
  $("#attendanceReasonTitle").textContent = `Mark ${status}`;
  $("#attendanceReasonDialog").showModal();
}

function assignRooms() {
  state.participants.filter((p) => currentRegistration(p)?.status === "Confirmed" && !currentRegistration(p)?.roomId).forEach((participant) => {
    const registration = currentRegistration(participant);
    const room = state.rooms.find((candidate) => {
      const occupied = state.participants.filter((p) => currentRegistration(p)?.roomId === candidate.id).length;
      const genderMatch = candidate.gender === participant.gender || candidate.gender === "Other";
      return genderMatch && occupied < candidate.beds;
    });
    if (room) {
      registration.roomId = room.id;
      syncParticipantFromRegistration(participant, registration);
    }
  });
  renderAll();
  showToast("Rooms assigned where matching beds were available.");
}

function generateCertificates() {
  let count = 0;
  state.participants.forEach((participant) => registrationsForParticipant(participant).forEach((registration) => {
    if (registration.completion === "Completed" && !registration.certificate) {
      registration.certificate = true;
      if (registration === currentRegistration(participant)) {
        syncParticipantFromRegistration(participant, registration);
      }
      count += 1;
    }
  }));
  renderAll();
  showToast(count ? `${count} certificate record(s) generated.` : "No pending certificates to generate.");
}

function openTeacherDialog(teacherId = "") {
  const form = $("#teacherForm");
  form.reset();
  form.elements.id.value = teacherId;
  if (teacherId) {
    const teacher = assignableTeachers().find((item) => item.id === teacherId);
    if (!teacher) return;
    $("#teacherDialogTitle").textContent = "Edit Teacher Profile";
    form.elements.title.value = teacher.title || "";
    form.elements.firstName.value = teacher.firstName || splitTeacherName(teacher.name).firstName;
    form.elements.lastName.value = teacher.lastName || splitTeacherName(teacher.name).lastName;
    form.elements.speciality.value = teacher.speciality;
    form.elements.phone.value = teacher.phone;
    form.elements.contactNumber.value = teacher.contactNumber || "";
    form.elements.email.value = teacher.email;
    form.elements.photo.value = teacher.photo || "";
    form.elements.gender.value = teacher.gender || "";
    form.elements.maritalStatus.value = teacher.maritalStatus || "";
    form.elements.education.value = teacher.education || "";
    form.elements.notes.value = teacher.notes || "";
  } else {
    $("#teacherDialogTitle").textContent = "Edit Teacher Profile";
  }
  $("#teacherDialog").showModal();
}

function openParticipantDialog(participantId = "") {
  const participant = state.participants.find((item) => item.id === participantId);
  if (!participant || !canEditParticipant(participant.id)) return;
  const form = $("#participantForm");
  form.reset();
  form.elements.id.value = participant.id;
  form.elements.name.value = participant.name || "";
  form.elements.age.value = participant.age || "";
  form.elements.gender.value = participant.gender || "Female";
  form.elements.phone.value = participant.phone || "";
  form.elements.email.value = participant.email || "";
  form.elements.photo.value = participant.photo || "";
  form.elements.emergencyContact.value = participant.emergencyContact || "";
  form.elements.address.value = participant.address || "";
  form.elements.notes.value = participant.notes || "";
  $("#participantDialog").showModal();
}

function saveParticipantProfile(form) {
  const data = new FormData(form);
  const participant = state.participants.find((item) => item.id === data.get("id"));
  if (!participant || !canEditParticipant(participant.id)) return;
  participant.name = data.get("name").trim();
  participant.age = Number(data.get("age")) || participant.age;
  participant.gender = data.get("gender");
  participant.phone = data.get("phone").trim();
  participant.email = data.get("email").trim();
  participant.photo = data.get("photo").trim();
  participant.emergencyContact = data.get("emergencyContact").trim();
  participant.address = data.get("address").trim();
  participant.notes = data.get("notes").trim();
  $("#participantDialog").close();
  renderAll();
  showToast("Personal details updated.");
}

function addOrEditBlock(blockId = "") {
  const block = state.blocks.find((item) => item.id === blockId);
  openRecordDialog("block", blockId, "Accommodation", block ? "Edit Block" : "Add Block", [
    ["name", "Block Name", block?.name || "", "text"],
    ["notes", "Notes", block?.notes || "", "textarea"]
  ]);
}

function addOrEditRoom(roomId = "") {
  const room = state.rooms.find((item) => item.id === roomId);
  const floorOptions = state.floors.map((floor) => ({ value: floor.id, label: `${floor.name} - ${blockName(floor.blockId)}` }));
  openRecordDialog("room", roomId, "Accommodation", room ? "Edit Room" : "Add Room", [
    ["name", "Room Name", room?.name || "", "text"],
    ["floorId", "Floor", room?.floorId || state.floors[0]?.id || "", "select", floorOptions.length ? floorOptions : [{ value: "", label: "Create a floor first" }]],
    ["gender", "Room Type", normalizeRoomType(room?.gender), "select", roomTypeOptions(room?.gender)],
    ["beds", "Beds", room?.beds || "4", "number"],
    ["status", "Cleaning Status", normalizeRoomStatus(room?.status), "select", roomStatusOptions(room?.status)],
    ["cleaningNotes", "Cleaning Notes", room?.cleaningNotes || "", "textarea"]
  ]);
}

function addOrEditFloor(floorId = "") {
  const floor = state.floors.find((item) => item.id === floorId);
  const blockOptions = state.blocks.map((block) => ({ value: block.id, label: block.name }));
  openRecordDialog("floor", floorId, "Accommodation", floor ? "Edit Floor" : "Add Floor", [
    ["name", "Floor Name", floor?.name || "", "text"],
    ["blockId", "Block", floor?.blockId || state.blocks[0]?.id || "", "select", blockOptions.length ? blockOptions : [{ value: "", label: "Create a block first" }]]
  ]);
}

function addOrEditHall(hallId = "") {
  const hall = state.halls.find((item) => item.id === hallId);
  openRecordDialog("hall", hallId, "Program Hall Master", hall ? "Edit Hall" : "Add Hall", [
    ["name", "Hall Name", hall?.name || "", "text"],
    ["capacity", "Capacity", hall?.capacity || "40", "number"],
    ["location", "Location", hall?.location || "", "text"],
    ["notes", "Notes", hall?.notes || "", "textarea"]
  ]);
}

function addOrEditHallBooking(bookingId = "") {
  const booking = state.hallBookings.find((item) => item.id === bookingId);
  const course = state.courses.find((item) => item.id === (booking?.courseId || selectedCourseId));
  openRecordDialog("hallBooking", bookingId, "Program Halls", booking ? "Edit Booking" : "Add Booking", [
    ["courseId", "Program ID", booking?.courseId || selectedCourseId || state.courses[0]?.id || "", "text", state.courses.map((item) => `${item.id}: ${item.name}`).join(" | ")],
    ["hallId", "Hall ID", booking?.hallId || state.halls[0]?.id || "", "text", state.halls.map((hall) => `${hall.id}: ${hall.name}`).join(" | ")],
    ["start", "Start Date", booking?.start || course?.start || "", "date"],
    ["end", "End Date", booking?.end || course?.end || "", "date"],
    ["notes", "Notes", booking?.notes || "", "textarea"]
  ]);
}

function addOrEditProgramSession(programId, sessionId = "") {
  const program = state.programs.find((item) => item.id === programId);
  if (!program) return;
  const session = (program.sessionTemplates || []).find((item) => item.id === sessionId);
  openRecordDialog("programSession", sessionId, "Course Session Plan", session ? "Edit Session" : "Add Session", [
    ["programId", "", programId, "hidden"],
    ["day", "Course Day", session?.day || "1", "number"],
    ["time", "Time", session?.time || "06:00-08:00", "text"],
    ["title", "Session Name", session?.title || "", "text"],
    ["topic", "Topic / Notes", session?.topic || "", "textarea"]
  ]);
}

function openAccessUserDialog(userId = "") {
  if (!canManageMasters()) return;
  const form = $("#accessUserForm");
  const user = accessUsers.find((item) => item.user_id === userId);
  form.reset();
  form.elements.userId.value = userId;
  renderAccessManagement();
  $("#accessUserDialogTitle").textContent = user ? "Edit User Access" : "Add User";
  form.elements.email.readOnly = Boolean(user);
  form.querySelector(".password-field").hidden = Boolean(user);
  form.elements.password.required = !user;
  if (user) {
    const linkedTeacher = state.teachers.find((teacher) => teacher.id === user.linked_teacher_id);
    form.elements.displayName.value = user.display_name || "";
    form.elements.email.value = user.login_email || "";
    form.elements.roleId.value = user.role_id || accessRoles[0]?.id || "";
    form.elements.phone.value = linkedTeacher?.phone || "";
    form.elements.teacherSpeciality.value = linkedTeacher?.speciality || "";
    form.elements.linkedTeacherId.value = user.linked_teacher_id || "";
    form.elements.linkedParticipantId.value = user.linked_participant_id || "";
    form.elements.active.checked = Boolean(user.active);
  } else {
    form.elements.roleId.value = accessRoles.find((role) => role.id === "participant")?.id || accessRoles[0]?.id || "";
    form.elements.active.checked = true;
  }
  $("#accessUserDialog").showModal();
}

function openAccessRoleDialog(roleId = "") {
  if (!canManageMasters()) return;
  const form = $("#accessRoleForm");
  const role = accessRoles.find((item) => item.id === roleId);
  form.reset();
  form.elements.existingId.value = roleId;
  $("#accessRoleDialogTitle").textContent = role ? "Edit Role" : "Add Role";
  form.elements.id.readOnly = Boolean(role);
  if (role) {
    form.elements.id.value = role.id;
    form.elements.name.value = role.name;
    form.elements.description.value = role.description || "";
    form.elements.canManageMasters.checked = Boolean(role.can_manage_masters);
    form.elements.canReviewRegistrations.checked = Boolean(role.can_review_registrations);
    form.elements.canMarkAttendance.checked = Boolean(role.can_mark_attendance);
    form.elements.active.checked = Boolean(role.active);
  } else {
    form.elements.active.checked = true;
  }
  $("#accessRoleDialog").showModal();
}

async function saveAccessRole(form) {
  if (!supabaseClient || !canManageMasters()) return;
  const data = new FormData(form);
  const existingId = data.get("existingId");
  const roleId = (data.get("id") || existingId || "").trim().toLowerCase();
  const payload = {
    id: roleId,
    name: data.get("name").trim(),
    description: data.get("description").trim(),
    can_manage_masters: data.has("canManageMasters"),
    can_review_registrations: data.has("canReviewRegistrations"),
    can_mark_attendance: data.has("canMarkAttendance"),
    active: data.has("active"),
    updated_at: new Date().toISOString()
  };
  const result = existingId
    ? await supabaseClient.from("roles").update(payload).eq("id", existingId)
    : await supabaseClient.from("roles").insert(payload);
  if (result.error) {
    showToast(friendlyErrorMessage(result.error, "Unable to save this role."));
    return;
  }
  $("#accessRoleDialog").close();
  await loadAccessManagementData();
  renderAll();
  showToast(existingId ? "Role updated." : "Role added.");
}

async function saveAccessUser(form) {
  if (!supabaseClient || !canManageMasters()) return;
  const data = new FormData(form);
  const existingUserId = data.get("userId");
  let userId = existingUserId;
  if (!existingUserId) {
    const signupClient = createSupabaseSignupClient();
    if (!signupClient) {
      showToast("Supabase Auth is not configured.");
      return;
    }
    const signup = await signupClient.auth.signUp({
      email: data.get("email").trim(),
      password: data.get("password"),
      options: {
        data: { name: data.get("displayName").trim() }
      }
    });
    if (signup.error || !signup.data.user) {
      showToast(friendlyErrorMessage(signup.error, "Unable to create the login user. Please check the email and password."));
      return;
    }
    userId = signup.data.user.id;
  }
  const roleId = data.get("roleId");
  let linkedTeacherId = data.get("linkedTeacherId") || null;
  if (isTeacherRole(roleId) && !linkedTeacherId) {
    linkedTeacherId = `teacher-${userId}`;
  }
  if (isTeacherRole(roleId) && linkedTeacherId) {
    const splitName = splitTeacherName(data.get("displayName").trim());
    const teacherPayload = {
      id: linkedTeacherId,
      name: data.get("displayName").trim(),
      speciality: data.get("teacherSpeciality").trim() || "Faculty",
      phone: data.get("phone").trim(),
      email: data.get("email").trim(),
      photo: "",
      notes: "Created from user access",
      updated_at: new Date().toISOString()
    };
    if (supportsTeacherProfileFields) {
      Object.assign(teacherPayload, {
        title: "",
        first_name: splitName.firstName,
        last_name: splitName.lastName,
        contact_number: "",
        education: "",
        gender: "",
        marital_status: ""
      });
    }
    const teacherResult = await supabaseClient.from("teachers").upsert(teacherPayload);
    if (teacherResult.error) {
      showToast(friendlyErrorMessage(teacherResult.error, "Unable to save the linked teacher profile."));
      return;
    }
    const existingTeacher = state.teachers.find((teacher) => teacher.id === linkedTeacherId);
    const teacherState = {
      id: teacherPayload.id,
      title: teacherPayload.title || "",
      firstName: teacherPayload.first_name || splitName.firstName,
      lastName: teacherPayload.last_name || splitName.lastName,
      name: teacherPayload.name,
      speciality: teacherPayload.speciality,
      phone: teacherPayload.phone,
      email: teacherPayload.email,
      photo: teacherPayload.photo,
      contactNumber: teacherPayload.contact_number || "",
      education: teacherPayload.education || "",
      gender: teacherPayload.gender || "",
      maritalStatus: teacherPayload.marital_status || "",
      notes: teacherPayload.notes
    };
    if (existingTeacher) Object.assign(existingTeacher, teacherState);
    else state.teachers.push(teacherState);
  }
  const payload = {
    user_id: userId,
    role_id: roleId,
    display_name: data.get("displayName").trim(),
    login_email: data.get("email").trim(),
    linked_teacher_id: isTeacherRole(roleId) ? linkedTeacherId : null,
    linked_participant_id: data.get("linkedParticipantId") || null,
    active: data.has("active"),
    updated_at: new Date().toISOString()
  };
  const result = existingUserId
    ? await supabaseClient.from("user_roles").update(payload).eq("user_id", existingUserId)
    : await supabaseClient.from("user_roles").insert(payload);
  if (result.error) {
    showToast(friendlyErrorMessage(result.error, "Unable to save user access."));
    return;
  }
  $("#accessUserDialog").close();
  await loadAccessManagementData();
  renderAll();
  showToast(existingUserId ? "User access updated." : "User created and role assigned.");
}

async function toggleAccessUser(userId) {
  if (!canManageMasters()) return;
  const user = accessUsers.find((item) => item.user_id === userId);
  if (!user) return;
  const result = await supabaseClient
    .from("user_roles")
    .update({ active: !user.active, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  if (result.error) {
    showToast(friendlyErrorMessage(result.error, "Unable to update user access."));
    return;
  }
  await loadAccessManagementData();
  renderAll();
  showToast(user.active ? "User access deactivated." : "User access activated.");
}

async function toggleAccessRole(roleId) {
  if (!canManageMasters()) return;
  const role = accessRoles.find((item) => item.id === roleId);
  if (!role) return;
  if (role.active && accessUsers.some((user) => user.role_id === roleId && user.active)) {
    showToast("Cannot deactivate a role assigned to active users.");
    return;
  }
  const result = await supabaseClient
    .from("roles")
    .update({ active: !role.active, updated_at: new Date().toISOString() })
    .eq("id", roleId);
  if (result.error) {
    showToast(friendlyErrorMessage(result.error, "Unable to update this role."));
    return;
  }
  await loadAccessManagementData();
  renderAll();
  showToast(role.active ? "Role deactivated." : "Role activated.");
}

function applyProgramPlanToBatches(programId) {
  state.courses
    .filter((course) => course.programId === programId)
    .forEach((course) => applyCourseSessionPlan(course.id, false));
}

function applyCourseSessionPlan(courseId, shouldRender = true) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return;
  if (!course.programId) {
    showToast("Select a Course Master for this program first.");
    return;
  }
  course.sessions = defaultSessionPlan(courseId);
  const validSessionIds = new Set(course.sessions.map((session) => session.id));
  allRegistrationRows()
    .filter(({ registration }) => registration.courseId === courseId)
    .forEach(({ participant, registration }) => {
      registration.sessionAttendance = (registration.sessionAttendance || []).filter((record) => validSessionIds.has(record.sessionId));
      updateRegistrationCompletion(registration);
      if (registration === currentRegistration(participant)) {
        syncParticipantFromRegistration(participant, registration);
      }
    });
  if (shouldRender) {
    renderAll();
    showToast("Course session plan applied to program.");
  }
}

async function deleteProgramSession(programId, sessionId) {
  const program = state.programs.find((item) => item.id === programId);
  if (!program) return;
  const affectedCourses = state.courses.filter((course) => course.programId === programId);
  program.sessionTemplates = (program.sessionTemplates || []).filter((session) => session.id !== sessionId);
  applyProgramPlanToBatches(programId);
  if (supportsNormalizedSessions) {
    await deleteSupabaseRow("course_session_templates", sessionId);
    await Promise.all(affectedCourses.map((course) => deleteSupabaseWhere("batch_sessions", "batch_id", course.id)));
  }
  renderAll();
  showToast("Course session deleted and applied to programs.");
}

function openRecordDialog(mode, id, eyebrow, title, fields) {
  const form = $("#recordForm");
  form.reset();
  form.elements.mode.value = mode;
  form.elements.id.value = id;
  $("#recordDialogEyebrow").textContent = eyebrow;
  $("#recordDialogTitle").textContent = title;
  $("#recordFields").innerHTML = fields.map(([name, label, value, type, help]) => {
    const helpText = help ? `<span class="field-help">${help}</span>` : "";
    if (type === "hidden") {
      return `<input type="hidden" name="${name}" value="${value}">`;
    }
    if (type === "textarea") {
      return `<label class="wide">${label}<textarea name="${name}" rows="3">${value}</textarea>${helpText}</label>`;
    }
    if (type === "select") {
      const options = Array.isArray(help) ? help : [];
      return `<label>${label}<select name="${name}" required>${options.map((option) => `<option value="${option.value}" ${option.value === value ? "selected" : ""}>${option.label}</option>`).join("")}</select>${Array.isArray(help) ? "" : helpText}</label>`;
    }
    return `<label>${label}<input name="${name}" type="${type}" value="${value}" required>${helpText}</label>`;
  }).join("");
  $("#recordDialog").showModal();
}

function saveRecordForm(form) {
  const data = new FormData(form);
  const mode = data.get("mode");
  const id = data.get("id");
  if (mode === "block") {
    const record = state.blocks.find((item) => item.id === id);
    const payload = { name: data.get("name").trim(), gender: record?.gender || "", notes: data.get("notes").trim() };
    if (record) Object.assign(record, payload);
    else state.blocks.push({ id: newId("block"), ...payload });
  }
  if (mode === "floor") {
    const record = state.floors.find((item) => item.id === id);
    if (!data.get("blockId")) {
      showToast("Create a block before adding floors.");
      return;
    }
    const payload = { name: data.get("name").trim(), blockId: data.get("blockId").trim() };
    if (record) Object.assign(record, payload);
    else state.floors.push({ id: newId("floor"), ...payload });
  }
  if (mode === "room") {
    const record = state.rooms.find((item) => item.id === id);
    const floorId = data.get("floorId").trim();
    const floor = state.floors.find((item) => item.id === floorId);
    if (!floor) {
      showToast("Create a floor before adding rooms.");
      return;
    }
    const payload = { name: data.get("name").trim(), blockId: floor.blockId, floorId, gender: normalizeRoomType(data.get("gender")), beds: Number(data.get("beds")) || 1, status: normalizeRoomStatus(data.get("status")), cleaningNotes: data.get("cleaningNotes")?.trim() || "" };
    if (record) Object.assign(record, payload);
    else state.rooms.push({ id: newId("room"), ...payload });
  }
  if (mode === "hall") {
    const record = state.halls.find((item) => item.id === id);
    const payload = { name: data.get("name").trim(), capacity: Number(data.get("capacity")) || 1, location: data.get("location").trim(), notes: data.get("notes").trim() };
    if (record) Object.assign(record, payload);
    else state.halls.push({ id: newId("hall"), ...payload });
  }
  if (mode === "hallBooking") {
    const record = state.hallBookings.find((item) => item.id === id);
    const payload = { courseId: data.get("courseId").trim(), hallId: data.get("hallId").trim(), start: data.get("start"), end: data.get("end"), notes: data.get("notes").trim() };
    if (record) Object.assign(record, payload);
    else state.hallBookings.push({ id: newId("hallBooking"), ...payload });
    const course = state.courses.find((item) => item.id === payload.courseId);
    if (course) {
      course.hallId = payload.hallId;
      course.hall = hallName(payload.hallId);
    }
  }
  if (mode === "programSession") {
    const program = state.programs.find((item) => item.id === data.get("programId"));
    if (program) {
      program.sessionTemplates = Array.isArray(program.sessionTemplates) ? program.sessionTemplates : [];
      const record = program.sessionTemplates.find((item) => item.id === id);
      const payload = {
        day: Number(data.get("day")) || 1,
        time: data.get("time").trim(),
        title: data.get("title").trim(),
        topic: data.get("topic").trim()
      };
      if (record) Object.assign(record, payload);
      else program.sessionTemplates.push({ id: newId("programSession"), ...payload });
      program.sessionTemplates.sort((a, b) => Number(a.day) - Number(b.day) || a.time.localeCompare(b.time));
      applyProgramPlanToBatches(program.id);
    }
  }
  $("#recordDialog").close();
  renderAll();
  showToast("Record saved.");
}

async function deleteBlock(blockId) {
  if (state.rooms.some((room) => room.blockId === blockId)) {
    showToast("Cannot delete a block with rooms.");
    return;
  }
  state.blocks = state.blocks.filter((block) => block.id !== blockId);
  state.floors = state.floors.filter((floor) => floor.blockId !== blockId);
  await deleteSupabaseWhere("accommodation_floors", "block_id", blockId);
  await deleteSupabaseRow("accommodation_blocks", blockId);
  renderAll();
}

async function deleteRoom(roomId) {
  if (state.participants.some((participant) => currentRegistration(participant)?.roomId === roomId)) {
    showToast("Cannot delete an occupied room.");
    return;
  }
  state.rooms = state.rooms.filter((room) => room.id !== roomId);
  await deleteSupabaseRow("rooms", roomId);
  renderAll();
}

async function deleteFloor(floorId) {
  if (state.rooms.some((room) => room.floorId === floorId)) {
    showToast("Cannot delete a floor with rooms.");
    return;
  }
  state.floors = state.floors.filter((floor) => floor.id !== floorId);
  await deleteSupabaseRow("accommodation_floors", floorId);
  renderAll();
}

async function deleteHall(hallId) {
  if (state.hallBookings.some((booking) => booking.hallId === hallId)) {
    showToast("Cannot delete a hall with bookings.");
    return;
  }
  state.halls = state.halls.filter((hall) => hall.id !== hallId);
  await deleteSupabaseRow("program_halls", hallId);
  renderAll();
}

async function deleteHallBooking(bookingId) {
  state.hallBookings = state.hallBookings.filter((booking) => booking.id !== bookingId);
  await deleteSupabaseRow("hall_bookings", bookingId);
  renderAll();
}

async function deleteCourse(courseId) {
  const course = state.courses.find((item) => item.id === courseId);
  if (!course) return;
  if (allRegistrationRows().some(({ registration }) => registration.courseId === courseId)) {
    showToast("Cannot delete a program with registrations.");
    return;
  }
  state.courses = state.courses.filter((item) => item.id !== courseId);
  const bookingIds = state.hallBookings.filter((booking) => booking.courseId === courseId).map((booking) => booking.id);
  state.hallBookings = state.hallBookings.filter((booking) => booking.courseId !== courseId);
  if (supportsNormalizedSessions) {
    await deleteSupabaseWhere("session_attendance", "batch_id", courseId);
    await deleteSupabaseWhere("batch_sessions", "batch_id", courseId);
  }
  await Promise.all(bookingIds.map((bookingId) => deleteSupabaseRow("hall_bookings", bookingId)));
  await deleteSupabaseRow("batches", courseId);
  selectedCourseId = state.courses[0]?.id || "";
  openDetailView.courses = false;
  renderAll();
  showToast("Program deleted.");
}

function openProgramDialog(programId = "") {
  const form = $("#programForm");
  form.reset();
  form.elements.id.value = programId;
  renderProgramParentOptions(programId);
  renderProgramTeacherOptions();
  if (programId) {
    const program = state.programs.find((item) => item.id === programId);
    if (!program) return;
    $("#programDialogTitle").textContent = "Edit Course";
    form.elements.name.value = program.name;
    form.elements.code.value = program.code;
    form.elements.parentId.value = program.parentId;
    form.elements.level.value = program.level;
    form.elements.duration.value = program.duration || "";
    form.elements.eligibility.value = program.eligibility;
    form.elements.pricingText.value = pricingTiersText(program.pricingTiers);
    renderProgramTeacherOptions(program.teacherIds || []);
  } else {
    $("#programDialogTitle").textContent = "Add Course";
    form.elements.pricingText.value = pricingTiersText(defaultPricingTiers);
  }
  $("#programDialog").showModal();
}

async function deleteProgram(programId) {
  const program = state.programs.find((item) => item.id === programId);
  if (!program) return;
  const hasChildren = state.programs.some((item) => item.parentId === programId);
  if (hasChildren) {
    showToast("Cannot delete a course that has child courses.");
    return;
  }
  const hasBatch = state.courses.some((batch) => batch.name.toLowerCase().includes(program.name.toLowerCase()));
  if (hasBatch) {
    showToast("Cannot delete a course used by existing programs.");
    return;
  }
  state.programs = state.programs.filter((item) => item.id !== programId);
  if (supportsNormalizedSessions) await deleteSupabaseWhere("course_session_templates", "program_id", programId);
  await deleteSupabaseRow("course_masters", programId);
  renderAll();
  showToast("Course deleted.");
}

function bindEvents() {
  $("#addCourse").addEventListener("click", () => {
    if (!canManageMasters()) return;
    openCourseDialog();
  });
  $("#addProgram").addEventListener("click", () => canManageMasters() && openProgramDialog());
  $("#addRegistration").addEventListener("click", () => openRegistrationDialog());
  $("#addParticipantFromMaster").addEventListener("click", () => {
    openRegistrationDialog();
  });
  $("#forgotPasswordButton").addEventListener("click", () => $("#forgotPasswordDialog").showModal());
  $("#previousMonth").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderCalendar();
  });
  $("#nextMonth").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderCalendar();
  });
  $("#addAccommodationRecord").addEventListener("click", () => {
    if (!canManageMasters()) return;
    if (accommodationTab === "blocks") {
      addOrEditBlock();
      return;
    }
    if (accommodationTab === "floors") {
      addOrEditFloor();
      return;
    }
    addOrEditRoom();
  });
  $("#addHall").addEventListener("click", () => canManageMasters() && addOrEditHall());
  $("#addHallBooking").addEventListener("click", () => canManageMasters() && addOrEditHallBooking());
  $("#addAccessUser").addEventListener("click", () => openAccessUserDialog());
  $("#addAccessRole").addEventListener("click", () => openAccessRoleDialog());
  $("#generateCertificates").addEventListener("click", () => canManageMasters() && generateCertificates());
  $("#globalSearch")?.addEventListener("input", renderRegistrations);
  $("#portalFilterToggle").addEventListener("click", () => {
    const row = $("#portalFilterRow");
    row.hidden = !row.hidden;
    if (!row.hidden) $("#portalProgramFilter").focus();
  });
  $("#portalSortName").addEventListener("click", () => {
    portalProgramSort = "nameAsc";
    portalProgramPage = 1;
    renderPortal();
  });
  $("#portalSortDate").addEventListener("click", () => {
    portalProgramSort = portalProgramSort === "startAsc" ? "startDesc" : "startAsc";
    portalProgramPage = 1;
    renderPortal();
  });
  $("#portalProgramFilter").addEventListener("input", (event) => {
    portalProgramFilter = event.currentTarget.value;
    portalProgramPage = 1;
    renderPortal();
  });
  $("#portalPagination").addEventListener("click", (event) => {
    const button = event.target.closest("[data-portal-page]");
    if (!button) return;
    portalProgramPage += button.dataset.portalPage === "next" ? 1 : -1;
    renderPortal();
  });
  $("#registrationFilter").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    currentFilter = button.dataset.filter;
    $$("#registrationFilter button").forEach((item) => item.classList.toggle("is-selected", item === button));
    renderRegistrations();
  });
  $("#programListFilter").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-program-list-filter]");
    if (!button) return;
    programListFilter = button.dataset.programListFilter;
    openDetailView.courses = false;
    renderCourses();
  });
  $("#registrationModeTabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-registration-mode]");
    if (!button) return;
    setRegistrationMode(button.dataset.registrationMode);
  });
  $("#addBulkRegistrant").addEventListener("click", () => addBulkRegistrantRow());
  $("#courseSelect").addEventListener("change", () => renderRegistrationPricingOptions());
  $("#courseMasterTabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-course-master-tab]");
    if (!button) return;
    courseMasterTab = button.dataset.courseMasterTab;
    renderPrograms();
  });
  $("#accommodationTabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-accommodation-tab]");
    if (!button) return;
    accommodationTab = button.dataset.accommodationTab;
    renderRooms();
  });
  $("#hallTabs").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-hall-tab]");
    if (!button) return;
    hallTab = button.dataset.hallTab;
    renderHalls();
  });
  $("#batchProgramSelect").addEventListener("change", () => renderBatchTeacherOptions());
  $("#programTeacherOptions").addEventListener("change", (event) => {
    if (event.target.closest("[data-program-teacher-option]")) syncProgramTeacherSelection();
  });
  $("#roomAllotmentContent").addEventListener("change", (event) => {
    const allotment = event.target.closest("[data-room-allotment]");
    if (allotment) {
      allotRoomToRegistration(allotment.dataset.roomAllotment, allotment.dataset.registrationId, allotment.value);
      return;
    }
    const stayDate = event.target.closest("[data-stay-date]");
    if (stayDate) {
      updateRegistrationStayDate(stayDate.dataset.stayDate, stayDate.dataset.registrationId, stayDate.dataset.stayField, stayDate.value);
      return;
    }
    const stayAction = event.target.closest("[data-room-stay-action]");
    if (stayAction) {
      updateStayLifecycle(stayAction.dataset.id, stayAction.dataset.registrationId, stayAction.dataset.roomStayAction);
      return;
    }
    const cleanRoom = event.target.closest("[data-room-clean]");
    if (cleanRoom) {
      markRoomClean(cleanRoom.dataset.roomClean);
      return;
    }
    const availabilityFilter = event.target.closest("[data-room-availability-filter]");
    if (availabilityFilter) {
      roomAvailabilityFilter[availabilityFilter.dataset.roomAvailabilityFilter] = availabilityFilter.value;
      if (roomAvailabilityFilter.start && roomAvailabilityFilter.end && dateFromInput(roomAvailabilityFilter.start) > dateFromInput(roomAvailabilityFilter.end)) {
        roomAvailabilityFilter.end = roomAvailabilityFilter.start;
        showToast("Check-out date adjusted to match check-in.");
      }
      renderRoomAllotments();
    }
  });
  $("#roomAllotmentContent").addEventListener("click", (event) => {
    const stayAction = event.target.closest("[data-room-stay-action]");
    if (stayAction) {
      updateStayLifecycle(stayAction.dataset.id, stayAction.dataset.registrationId, stayAction.dataset.roomStayAction);
      return;
    }
    const cleanRoom = event.target.closest("[data-room-clean]");
    if (cleanRoom) {
      markRoomClean(cleanRoom.dataset.roomClean);
    }
  });
  document.body.addEventListener("input", (event) => {
    const filter = event.target.closest("[data-column-filter]");
    if (!filter) return;
    const key = filter.dataset.columnFilter;
    const columnKey = filter.dataset.columnKey;
    const cursor = filter.selectionStart;
    const stateForTable = tableConfig(key);
    stateForTable.filters[columnKey] = filter.value;
    stateForTable.page = 1;
    renderAll();
    requestAnimationFrame(() => {
      const nextFilter = document.querySelector(`[data-column-filter="${key}"][data-column-key="${columnKey}"]`);
      if (!nextFilter) return;
      nextFilter.focus();
      nextFilter.setSelectionRange(cursor, cursor);
    });
  });
  document.body.addEventListener("click", (event) => {
    const sort = event.target.closest("[data-column-sort]");
    const filterToggle = event.target.closest("[data-column-filter-toggle]");
    if (!sort && !filterToggle) return;
    event.preventDefault();
    event.stopPropagation();
    if (filterToggle) {
      const key = filterToggle.dataset.columnFilterToggle;
      const columnKey = filterToggle.dataset.columnKey;
      const stateForTable = tableConfig(key);
      stateForTable.filterOpen = stateForTable.filterOpen === columnKey ? "" : columnKey;
      renderAll();
      if (stateForTable.filterOpen === columnKey) {
        requestAnimationFrame(() => {
          const nextFilter = document.querySelector(`[data-column-filter="${key}"][data-column-key="${columnKey}"]`);
          if (nextFilter) nextFilter.focus();
        });
      }
      return;
    }
    const stateForTable = tableConfig(sort.dataset.columnSort);
    if (stateForTable.sort === sort.dataset.columnKey) {
      stateForTable.direction = stateForTable.direction === "asc" ? "desc" : "asc";
    } else {
      stateForTable.sort = sort.dataset.columnKey;
      stateForTable.direction = "asc";
    }
    stateForTable.page = 1;
    renderAll();
  });
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await login(form.get("identifier"), form.get("password"));
    event.currentTarget.reset();
  });
  $("#forgotPasswordForm").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    $("#forgotPasswordDialog").close();
    await requestPasswordReset(form.get("identifier"));
    event.currentTarget.reset();
  });
  document.body.addEventListener("click", async (event) => {
    const logoutButton = event.target.closest("#logoutButton");
    if (logoutButton) {
      await logout();
      return;
    }
    const publicRegister = event.target.closest("[data-public-register]");
    if (publicRegister) {
      const course = state.courses.find((item) => item.id === publicRegister.dataset.publicRegister);
      if (!course || !isPortalProgram(course)) {
        showToast("Registration is open only for upcoming programs.");
        return;
      }
      openRegistrationDialog(publicRegister.dataset.publicRegister);
      return;
    }
    const cancelRegistration = event.target.closest("#closeRegistration, #cancelRegistration");
    if (cancelRegistration) {
      event.preventDefault();
      $("#registrationDialog").close();
      return;
    }
    const cancelForgotPassword = event.target.closest("#closeForgotPassword, #cancelForgotPassword");
    if (cancelForgotPassword) {
      event.preventDefault();
      $("#forgotPasswordDialog").close();
      return;
    }
    const cancelCourse = event.target.closest("#closeCourse, #cancelCourse");
    if (cancelCourse) {
      event.preventDefault();
      $("#courseDialog").close();
      return;
    }
    const cancelProgram = event.target.closest("#closeProgram, #cancelProgram");
    if (cancelProgram) {
      event.preventDefault();
      $("#programDialog").close();
      return;
    }
    const cancelTeacher = event.target.closest("#closeTeacher, #cancelTeacher");
    if (cancelTeacher) {
      event.preventDefault();
      $("#teacherDialog").close();
      return;
    }
    const cancelParticipant = event.target.closest("#closeParticipant, #cancelParticipant");
    if (cancelParticipant) {
      event.preventDefault();
      $("#participantDialog").close();
      return;
    }
    const cancelRecord = event.target.closest("#closeRecord, #cancelRecord");
    if (cancelRecord) {
      event.preventDefault();
      $("#recordDialog").close();
      return;
    }
    const cancelAccessUser = event.target.closest("#closeAccessUser, #cancelAccessUser");
    if (cancelAccessUser) {
      event.preventDefault();
      $("#accessUserDialog").close();
      return;
    }
    const cancelAccessRole = event.target.closest("#closeAccessRole, #cancelAccessRole");
    if (cancelAccessRole) {
      event.preventDefault();
      $("#accessRoleDialog").close();
      return;
    }
    const cancelBulkEdit = event.target.closest("#closeBulkEdit, #cancelBulkEdit");
    if (cancelBulkEdit) {
      event.preventDefault();
      $("#bulkEditDialog").close();
      return;
    }
    const cancelAttendanceReason = event.target.closest("#closeAttendanceReason, #cancelAttendanceReason");
    if (cancelAttendanceReason) {
      event.preventDefault();
      $("#attendanceReasonDialog").close();
      return;
    }
    const jump = event.target.closest("[data-jump]");
    if (jump) activateView(jump.dataset.jump);
    const openCourse = event.target.closest("[data-course-open]");
    if (openCourse) {
      const openedCourseId = openCourse.dataset.courseOpen;
      openLinkedRecord("courses", { courseId: openedCourseId }, currentViewId() === "programs" ? "Back to Course" : "Back to Dashboard");
      requestAnimationFrame(() => {
        document.querySelector(`[data-batch-view="${openedCourseId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    const editCourse = event.target.closest("[data-course-edit]");
    if (editCourse) {
      if (!canManageMasters()) return;
      openCourseDialog(editCourse.dataset.courseEdit);
      return;
    }
    const linkedProgram = event.target.closest("[data-linked-program]");
    if (linkedProgram) {
      openLinkedRecord("programs", { programId: linkedProgram.dataset.linkedProgram }, "Back to Teacher");
      return;
    }
    const deleteCourseButton = event.target.closest("[data-course-delete]");
    if (deleteCourseButton) {
      if (!canManageMasters()) return;
      await deleteCourse(deleteCourseButton.dataset.courseDelete);
      return;
    }
    const linkBack = event.target.closest("[data-link-back]");
    if (linkBack) {
      const previous = linkBackStack.pop();
      if (previous) restoreSelectionState(previous);
      return;
    }
    const recordBack = event.target.closest("[data-record-back]");
    if (recordBack) {
      openDetailView[recordBack.dataset.recordBack] = false;
      linkBackStack = [];
      renderAll();
      return;
    }
    const tablePage = event.target.closest("[data-table-page]");
    if (tablePage) {
      const stateForTable = tableConfig(tablePage.dataset.tablePage);
      stateForTable.page += tablePage.dataset.pageDirection === "next" ? 1 : -1;
      renderAll();
      return;
    }
    const rowSelectAll = event.target.closest("[data-row-select-all]");
    if (rowSelectAll) {
      const key = rowSelectAll.dataset.rowSelectAll;
      const selected = bulkSet(key);
      document.querySelectorAll(`[data-row-select="${key}"]`).forEach((checkbox) => {
        checkbox.checked = rowSelectAll.checked;
        if (rowSelectAll.checked) selected.add(checkbox.value);
        else selected.delete(checkbox.value);
      });
      renderAll();
      return;
    }
    const rowSelect = event.target.closest("[data-row-select]");
    if (rowSelect) {
      const selected = bulkSet(rowSelect.dataset.rowSelect);
      if (rowSelect.checked) selected.add(rowSelect.value);
      else selected.delete(rowSelect.value);
      renderAll();
      return;
    }
    const removeBulkRegistrant = event.target.closest("[data-remove-bulk-registrant]");
    if (removeBulkRegistrant) {
      const row = removeBulkRegistrant.closest(".bulk-registrant-row");
      if (row && document.querySelectorAll(".bulk-registrant-row").length > 1) row.remove();
      else showToast("At least one registrant row is required.");
      return;
    }
    const bulkClear = event.target.closest("[data-bulk-clear]");
    if (bulkClear) {
      bulkSet(bulkClear.dataset.bulkClear).clear();
      renderAll();
      return;
    }
    const bulkEdit = event.target.closest("[data-bulk-edit]");
    if (bulkEdit) {
      openBulkEditDialog(bulkEdit.dataset.bulkEdit);
      return;
    }
    const linkedTeacher = event.target.closest("[data-linked-teacher]");
    if (linkedTeacher) {
      if (!canAccessView("teachers")) {
        showToast("Login as a Teacher or Admin to open teacher records.");
        return;
      }
      openLinkedRecord("teachers", { teacherId: linkedTeacher.dataset.linkedTeacher }, "Back to Program");
      return;
    }
    const linkedBatch = event.target.closest("[data-linked-batch]");
    if (linkedBatch) {
      openLinkedRecord("courses", { courseId: linkedBatch.dataset.linkedBatch }, "Back");
      return;
    }
    const linkedParticipant = event.target.closest("[data-linked-participant]");
    if (linkedParticipant) {
      if (currentSession.role === "participant" && linkedParticipant.dataset.linkedParticipant !== currentSession.id) {
        showToast("Participants can view only their own record.");
        return;
      }
      openLinkedRecord("participants", { participantId: linkedParticipant.dataset.linkedParticipant }, "Back to Program");
      return;
    }
    const batchView = event.target.closest("[data-batch-view]");
    if (batchView) {
      selectedCourseId = batchView.dataset.batchView;
      openDetailView.courses = true;
      renderCourses();
      return;
    }
    const editProgram = event.target.closest("[data-program-edit]");
    if (editProgram) {
      if (!canManageMasters()) return;
      openProgramDialog(editProgram.dataset.programEdit);
      return;
    }
    const deleteProgramButton = event.target.closest("[data-program-delete]");
    if (deleteProgramButton) {
      if (!canManageMasters()) return;
      deleteProgram(deleteProgramButton.dataset.programDelete);
      return;
    }
    const editTeacher = event.target.closest("[data-teacher-edit]");
    if (editTeacher) {
      if (!canEditTeacher(editTeacher.dataset.teacherEdit)) return;
      openTeacherDialog(editTeacher.dataset.teacherEdit);
      return;
    }
    const editParticipant = event.target.closest("[data-participant-edit]");
    if (editParticipant) {
      if (!canEditParticipant(editParticipant.dataset.participantEdit)) return;
      openParticipantDialog(editParticipant.dataset.participantEdit);
      return;
    }
    const editBlock = event.target.closest("[data-block-edit]");
    if (editBlock) {
      if (!canManageMasters()) return;
      addOrEditBlock(editBlock.dataset.blockEdit);
      return;
    }
    const deleteBlockButton = event.target.closest("[data-block-delete]");
    if (deleteBlockButton) {
      if (!canManageMasters()) return;
      deleteBlock(deleteBlockButton.dataset.blockDelete);
      return;
    }
    const editRoom = event.target.closest("[data-room-edit]");
    if (editRoom) {
      if (!canManageMasters()) return;
      addOrEditRoom(editRoom.dataset.roomEdit);
      return;
    }
    const deleteRoomButton = event.target.closest("[data-room-delete]");
    if (deleteRoomButton) {
      if (!canManageMasters()) return;
      deleteRoom(deleteRoomButton.dataset.roomDelete);
      return;
    }
    const editFloor = event.target.closest("[data-floor-edit]");
    if (editFloor) {
      if (!canManageMasters()) return;
      addOrEditFloor(editFloor.dataset.floorEdit);
      return;
    }
    const deleteFloorButton = event.target.closest("[data-floor-delete]");
    if (deleteFloorButton) {
      if (!canManageMasters()) return;
      deleteFloor(deleteFloorButton.dataset.floorDelete);
      return;
    }
    const editHall = event.target.closest("[data-hall-edit]");
    if (editHall) {
      if (!canManageMasters()) return;
      addOrEditHall(editHall.dataset.hallEdit);
      return;
    }
    const deleteHallButton = event.target.closest("[data-hall-delete]");
    if (deleteHallButton) {
      if (!canManageMasters()) return;
      deleteHall(deleteHallButton.dataset.hallDelete);
      return;
    }
    const editHallBooking = event.target.closest("[data-hall-booking-edit]");
    if (editHallBooking) {
      if (!canManageMasters()) return;
      addOrEditHallBooking(editHallBooking.dataset.hallBookingEdit);
      return;
    }
    const deleteHallBookingButton = event.target.closest("[data-hall-booking-delete]");
    if (deleteHallBookingButton) {
      if (!canManageMasters()) return;
      deleteHallBooking(deleteHallBookingButton.dataset.hallBookingDelete);
      return;
    }
    const addProgramSessionButton = event.target.closest("[data-program-session-add]");
    if (addProgramSessionButton) {
      if (!canManageMasters()) return;
      addOrEditProgramSession(addProgramSessionButton.dataset.programSessionAdd);
      return;
    }
    const editProgramSessionButton = event.target.closest("[data-program-session-edit]");
    if (editProgramSessionButton) {
      if (!canManageMasters()) return;
      addOrEditProgramSession(editProgramSessionButton.dataset.programSessionEdit, editProgramSessionButton.dataset.sessionTemplateId);
      return;
    }
    const deleteProgramSessionButton = event.target.closest("[data-program-session-delete]");
    if (deleteProgramSessionButton) {
      if (!canManageMasters()) return;
      deleteProgramSession(deleteProgramSessionButton.dataset.programSessionDelete, deleteProgramSessionButton.dataset.sessionTemplateId);
      return;
    }
    const markSessionPresentButton = event.target.closest("[data-mark-session-present]");
    if (markSessionPresentButton) {
      markSessionPresentForAll(markSessionPresentButton.dataset.courseId, markSessionPresentButton.dataset.markSessionPresent);
      return;
    }
    const attendanceButton = event.target.closest("[data-attendance-status]");
    if (attendanceButton) {
      markSessionAttendance(
        attendanceButton.dataset.id,
        attendanceButton.dataset.registrationId,
        attendanceButton.dataset.sessionId,
        attendanceButton.dataset.attendanceStatus
      );
      return;
    }
    const editAccessUser = event.target.closest("[data-access-user-edit]");
    if (editAccessUser) {
      openAccessUserDialog(editAccessUser.dataset.accessUserEdit);
      return;
    }
    const toggleAccessUserButton = event.target.closest("[data-access-user-toggle]");
    if (toggleAccessUserButton) {
      await toggleAccessUser(toggleAccessUserButton.dataset.accessUserToggle);
      return;
    }
    const editAccessRole = event.target.closest("[data-access-role-edit]");
    if (editAccessRole) {
      openAccessRoleDialog(editAccessRole.dataset.accessRoleEdit);
      return;
    }
    const toggleAccessRoleButton = event.target.closest("[data-access-role-toggle]");
    if (toggleAccessRoleButton) {
      await toggleAccessRole(toggleAccessRoleButton.dataset.accessRoleToggle);
      return;
    }
    const teacherView = event.target.closest("[data-teacher-view]");
    if (teacherView && !event.target.closest("button")) {
      selectedTeacherId = teacherView.dataset.teacherView;
      openDetailView.teachers = true;
      renderTeachers();
      return;
    }
    const programView = event.target.closest("[data-program-view]");
    if (programView && !event.target.closest("button")) {
      selectedProgramId = programView.dataset.programView;
      openDetailView.programs = true;
      renderPrograms();
      return;
    }
    const participantView = event.target.closest("[data-participant-view]");
    if (participantView) {
      selectedParticipantId = participantView.dataset.participantView;
      openDetailView.participants = true;
      renderParticipantsMaster();
      return;
    }
    const registerButton = event.target.closest("[data-course-register]");
    if (registerButton) {
      const course = state.courses.find((item) => item.id === registerButton.dataset.courseRegister);
      if (!course || !isPortalProgram(course)) {
        showToast("Registration is open only for upcoming programs.");
        return;
      }
      openRegistrationDialog(registerButton.dataset.courseRegister);
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const id = action.dataset.id;
    const type = action.dataset.action;
    const registrationId = action.dataset.registrationId;
    if (!canReviewRegistrations()) {
      showToast("This login has view-only access for this action.");
      return;
    }
    if (registrationId) {
      const actionParticipant = state.participants.find((item) => item.id === id);
      const actionRegistration = actionParticipant ? registrationsForParticipant(actionParticipant).find((item) => item.id === registrationId) : null;
      if (!actionParticipant || !actionRegistration) return;
      if (["eligible", "approve", "confirm"].includes(type) && !canApproveRegistration(actionParticipant, actionRegistration)) return;
      if (type === "eligible") updateRegistration(id, registrationId, (registration) => registration.eligible = true, "Eligibility verified.");
      if (type === "paid") updateRegistration(id, registrationId, (registration) => {
        registration.paymentStatus = "Paid";
        registration.status = requiresRefresherCompletionVerification(actionParticipant, registration)
          ? "Pending"
          : seatStatusForRegistration(registration.courseId, registration.paymentStatus, registration.id);
      }, "Payment marked paid.");
      if (type === "approve") updateRegistration(id, registrationId, (registration) => {
        registration.paymentStatus = "Approved";
        registration.eligible = true;
        registration.status = seatStatusForRegistration(registration.courseId, registration.paymentStatus, registration.id);
      }, "Payment approved.");
      if (type === "confirm") updateRegistration(id, registrationId, (registration) => { registration.status = seatStatusForRegistration(registration.courseId, "Approved", registration.id); registration.paymentStatus = "Approved"; registration.eligible = true; }, "Registration confirmed.");
      if (type === "waitlist") updateRegistration(id, registrationId, (registration) => registration.status = "Waitlist", "Participant moved to waitlist.");
      if (type === "cancel") updateRegistration(id, registrationId, (registration) => {
        const courseId = registration.courseId;
        const participant = state.participants.find((item) => item.id === id);
        if (participant) releaseAccommodationForRegistration(participant, registration, "Cancellation");
        registration.status = "Cancelled";
        const promoted = promoteWaitlistForCourse(courseId);
        if (promoted) showToast(`${promoted} moved from waitlist to confirmed.`);
      }, "Registration cancelled.");
      return;
    }
    if (type === "checkin") updateParticipant(id, (p) => p.checkedIn = true, "Participant checked in.");
    if (type === "attend") updateParticipant(id, (p) => p.attendance += 1, "Attendance recorded.");
    if (type === "complete") updateParticipant(id, (p) => p.completion = "Completed", "Completion approved.");
    if (type === "dropout") {
      const participant = state.participants.find((item) => item.id === id);
      const registration = participant ? currentRegistration(participant) : null;
      if (participant && registration) {
        const courseId = registration.courseId;
        releaseAccommodationForRegistration(participant, registration, "Dropout");
        registration.completion = "Dropout";
        registration.status = "Dropout";
        syncParticipantFromRegistration(participant, registration);
        const promoted = promoteWaitlistForCourse(courseId);
        renderAll();
        showToast(promoted ? `Dropout recorded. ${promoted} moved from waitlist to confirmed.` : "Dropout recorded.");
      }
    }
  });
  document.body.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const batchView = event.target.closest("[data-batch-view]");
    if (batchView) {
      event.preventDefault();
      selectedCourseId = batchView.dataset.batchView;
      openDetailView.courses = true;
      renderCourses();
      return;
    }
    const teacherView = event.target.closest("[data-teacher-view]");
    if (teacherView) {
      event.preventDefault();
      selectedTeacherId = teacherView.dataset.teacherView;
      openDetailView.teachers = true;
      renderTeachers();
      return;
    }
    const programView = event.target.closest("[data-program-view]");
    if (programView) {
      event.preventDefault();
      selectedProgramId = programView.dataset.programView;
      openDetailView.programs = true;
      renderPrograms();
      return;
    }
    const participantView = event.target.closest("[data-participant-view]");
    if (!participantView) return;
    event.preventDefault();
    selectedParticipantId = participantView.dataset.participantView;
    openDetailView.participants = true;
    renderParticipantsMaster();
  });
  $("#registrationForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const courseId = form.get("course");
    if (!state.courses.some((course) => course.id === courseId)) {
      showToast("Create a scheduled Program before adding registrations.");
      return;
    }
    const mode = form.get("registrationMode");
    const loggedParticipant = currentParticipant();
    const registrants = mode === "bulk" ? bulkRegistrantDetails() : [{
      participantId: loggedParticipant?.id || "",
      name: form.get("name"),
      age: form.get("age"),
      gender: form.get("gender"),
      phone: form.get("phone"),
      email: form.get("email"),
      pricingCategory: form.get("pricingCategory"),
      paymentStatus: form.get("paymentStatus"),
      accommodationType: form.get("accommodationType"),
      photo: form.get("photo"),
      emergencyContact: form.get("emergencyContact"),
      address: form.get("address"),
      notes: form.get("notes")
    }];
    const validRegistrants = registrants.filter((item) => item.name.trim() && item.phone.trim() && item.email.trim());
    if (!validRegistrants.length) {
      showToast("Add at least one registrant with name, phone, and email.");
      return;
    }
    const savedParticipants = validRegistrants.map((details) => registerParticipantForCourse(details, courseId));
    selectedParticipantId = savedParticipants.at(-1)?.id || selectedParticipantId;
    event.currentTarget.reset();
    $("#bulkRegistrantRows").innerHTML = "";
    setRegistrationMode("individual");
    $("#registrationDialog").close();
    activateView("registrations");
    renderAll();
    showToast(`${savedParticipants.length} registration${savedParticipants.length === 1 ? "" : "s"} submitted.`);
  });
  $("#courseForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const start = form.get("start");
    const end = form.get("end");
    if (end < start) {
      showToast("End date cannot be before start date.");
      return;
    }
    const hallId = form.get("hallId");
    const programId = form.get("programId");
    const program = state.programs.find((item) => item.id === programId);
    if (!program) {
      showToast("Create a Course Master before scheduling a program.");
      return;
    }
    if (!hallId || !state.halls.some((hall) => hall.id === hallId)) {
      showToast("Create a Program Hall before scheduling a program.");
      return;
    }
    const teacherName = form.get("teacher").trim();
    if (!teacherName) {
      showToast("Assign teachers to this Course Master before scheduling a program.");
      return;
    }
    const existingCourseId = form.get("id");
    const existingCourse = state.courses.find((course) => course.id === existingCourseId);
    const courseId = existingCourse?.id || newId("course");
    const previousProgramId = existingCourse?.programId || "";
    const requestedSeats = Number(form.get("seats")) || 1;
    const availableBeds = totalAvailableBedsForDateRange(start, end);
    if (availableBeds < requestedSeats) {
      showToast(`Only ${availableBeds} clean bed(s) available for these dates. Reduce seats or clean/add rooms before scheduling.`);
      return;
    }
    const courseData = {
      id: courseId,
      programId,
      name: form.get("name").trim(),
      start,
      end,
      seats: requestedSeats,
      hallId,
      hall: hallName(hallId),
      teacher: teacherName,
      eligibility: form.get("eligibility").trim() || program?.eligibility || ""
    };
    courseData.status = programLifecycleStatus(courseData);
    if (existingCourse) {
      const shouldRefreshSessions = previousProgramId !== programId || existingCourse.start !== start || existingCourse.end !== end;
      Object.assign(existingCourse, courseData);
      existingCourse.sessions = shouldRefreshSessions ? defaultSessionPlan(courseId) : existingCourse.sessions || defaultSessionPlan(courseId);
      const booking = state.hallBookings.find((item) => item.courseId === courseId);
      if (booking) Object.assign(booking, { hallId, start, end });
      else state.hallBookings.push({ id: newId("hallBooking"), courseId, hallId, start, end, notes: "Created from program schedule" });
    } else {
      state.courses.push(courseData);
      courseData.sessions = defaultSessionPlan(courseId);
      state.hallBookings.push({
        id: newId("hallBooking"),
        courseId,
        hallId,
        start,
        end,
        notes: "Created from program schedule"
      });
      const reRegistered = seedReRegistrationsForCourse(courseData);
      if (reRegistered) courseData.reRegisteredCount = reRegistered;
    }
    calendarDate = new Date(`${start}T00:00:00`);
    selectedCourseId = courseId;
    event.currentTarget.reset();
    $("#courseDialog").close();
    activateView("courses");
    renderAll();
    showToast(existingCourse ? "Program updated." : `Program schedule added.${courseData.reRegisteredCount ? ` ${courseData.reRegisteredCount} past candidate(s) re-registered.` : ""}`);
  });
  $("#programForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existingProgram = state.programs.find((program) => program.id === form.get("id"));
    const programId = form.get("id") || newId("program");
    const programData = {
      id: programId,
      parentId: form.get("parentId"),
      code: form.get("code").trim(),
      name: form.get("name").trim(),
      level: form.get("level").trim(),
      duration: form.get("duration").trim(),
      eligibility: form.get("eligibility").trim(),
      sessionTemplates: existingProgram?.sessionTemplates || [],
      teacherIds: form.get("teacherIds").split(",").filter(Boolean),
      pricingTiers: parsePricingTiers(form.get("pricingText"))
    };
    const existingIndex = state.programs.findIndex((program) => program.id === programData.id);
    if (existingIndex >= 0) {
      state.programs[existingIndex] = programData;
    } else {
      state.programs.push(programData);
    }
    event.currentTarget.reset();
    $("#programDialog").close();
    renderAll();
    showToast(existingIndex >= 0 ? "Course updated." : "Course added.");
  });
  $("#teacherForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = form.get("title");
    const firstName = form.get("firstName").trim();
    const lastName = form.get("lastName").trim();
    const teacherData = {
      id: form.get("id") || newId("teacher"),
      title,
      firstName,
      lastName,
      name: [title, firstName, lastName].filter(Boolean).join(" ").trim(),
      speciality: form.get("speciality").trim(),
      phone: form.get("phone").trim(),
      contactNumber: form.get("contactNumber").trim(),
      email: form.get("email").trim(),
      photo: form.get("photo").trim(),
      gender: form.get("gender"),
      maritalStatus: form.get("maritalStatus"),
      education: form.get("education").trim(),
      notes: form.get("notes").trim()
    };
    if (!canEditTeacher(teacherData.id)) {
      showToast("You can edit only your own teacher profile.");
      return;
    }
    const existingIndex = state.teachers.findIndex((teacher) => teacher.id === teacherData.id);
    if (existingIndex >= 0) {
      const previousName = state.teachers[existingIndex].name;
      const previousDisplayName = teacherDisplayName(state.teachers[existingIndex]);
      state.teachers[existingIndex] = teacherData;
      state.courses.forEach((course) => {
        if (course.teacher === previousName || course.teacher === previousDisplayName) course.teacher = teacherData.name;
      });
    } else {
      const previousTeacher = assignableTeachers().find((teacher) => teacher.id === teacherData.id);
      state.teachers.push(teacherData);
      state.courses.forEach((course) => {
        if (previousTeacher && (course.teacher === previousTeacher.name || course.teacher === teacherDisplayName(previousTeacher))) course.teacher = teacherData.name;
      });
    }
    event.currentTarget.reset();
    $("#teacherDialog").close();
    renderAll();
    showToast(existingIndex >= 0 ? "Teacher updated." : "Teacher added to master.");
  });
  $("#participantForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    saveParticipantProfile(event.currentTarget);
  });
  $("#recordForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    saveRecordForm(event.currentTarget);
  });
  $("#accessUserForm").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    await saveAccessUser(event.currentTarget);
  });
  $("#accessRoleForm").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    await saveAccessRole(event.currentTarget);
  });
  $("#bulkEditField").addEventListener("change", (event) => {
    renderBulkValueInput($("#bulkEditForm").elements.tableKey.value);
  });
  $("#bulkEditForm").addEventListener("submit", async (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    await applyBulkEdit(event.currentTarget);
  });
  $("#attendanceReasonForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    $("#attendanceReasonDialog").close();
    markSessionAttendance(
      form.get("participantId"),
      form.get("registrationId"),
      form.get("sessionId"),
      form.get("status"),
      form.get("reason").trim()
    );
  });
}

renderNav();
bindEvents();
renderAll();
activateView(defaultViewForRole());
loadRemoteData();
