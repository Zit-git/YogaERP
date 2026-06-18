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

const state = loadData();
let currentSession = loadSession();
const supabaseClient = createSupabaseClient();
let hasLoadedRemoteData = false;
let isHydratingRemoteData = false;
let appUsers = [];
let remoteSaveTimer = null;
let remoteStatus = supabaseClient ? "Supabase connecting" : "Supabase not configured";
let currentFilter = "all";
let calendarDate = getInitialCalendarDate();
let selectedCourseId = "";
let selectedParticipantId = "";
let selectedTeacherId = "";
let linkBackStack = [];
let accommodationTab = "blocks";
let hallTab = "halls";

const views = [
  ["portal", "Portal"],
  ["dashboard", "Dashboard"],
  ["programs", "Courses"],
  ["courses", "Programs"],
  ["teachers", "Teachers"],
  ["participants", "Participants"],
  ["registrations", "Registrations"],
  ["accommodation", "Accommodation"],
  ["halls", "Program Halls"],
  ["certificates", "Certificates"]
];

const roleViews = {
  public: [],
  participant: ["courses", "participants"],
  teacher: ["dashboard", "courses", "teachers", "participants"],
  admin: views.filter(([id]) => id !== "portal").map(([id]) => id)
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

migrateState();

function loadData() {
  localStorage.removeItem("aliyar-management-data");
  return emptyState();
}

function createSupabaseClient() {
  const config = window.ALIYAR_SUPABASE || {};
  const hasConfig = config.url && config.anonKey;
  if (!hasConfig || !window.supabase?.createClient) return null;
  return window.supabase.createClient(config.url, config.anonKey);
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
    await loadSupabaseUsers();
    refreshCurrentSessionFromUsers();
    renderNav();
    const { data, error } = await supabaseClient
      .from("app_state")
      .select("payload")
      .eq("id", "current")
      .maybeSingle();
    if (error) throw error;
    let lifecycleChanged = false;
    if (data?.payload) {
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, data.payload);
      migrateState();
      lifecycleChanged = applyProgramLifecycleStatuses();
      remoteStatus = "Supabase connected";
    } else {
      const relationalState = await loadRelationalData();
      Object.keys(state).forEach((key) => delete state[key]);
      Object.assign(state, relationalState);
      migrateState();
      lifecycleChanged = applyProgramLifecycleStatuses();
      remoteStatus = hasAnyRecords(state) ? "Supabase connected" : "Supabase connected - no records yet";
    }
    hasLoadedRemoteData = true;
    calendarDate = getInitialCalendarDate();
    isHydratingRemoteData = true;
    renderAll();
    isHydratingRemoteData = false;
    if (!canAccessView(currentViewId())) activateView(defaultViewForRole());
    renderNav();
    if (lifecycleChanged) persistRemoteData();
  } catch (error) {
    remoteStatus = "Supabase unavailable";
    hasLoadedRemoteData = false;
    isHydratingRemoteData = false;
    renderAuthState();
    showToast(error.message || "Unable to load Supabase data.");
  }
}

async function loadSupabaseUsers() {
  if (!supabaseClient) return;
  const { data, error } = await supabaseClient
    .from("users")
    .select("id, login_id, password, role, display_name, linked_teacher_id, linked_participant_id, can_manage_masters, can_review_registrations, can_mark_attendance, active")
    .eq("active", true)
    .order("display_name");
  if (error) {
    appUsers = [];
    showToast("Run supabase/users_and_roles.sql to enable login users.");
    return;
  }
  appUsers = data || [];
}

function refreshCurrentSessionFromUsers() {
  if (currentSession.role === "public") return;
  const user = appUsers.find((item) => {
    if (currentSession.userId && item.id === currentSession.userId) return true;
    if (item.role !== currentSession.role) return false;
    if (item.role === "admin") return item.login_id === currentSession.id || currentSession.id === "admin";
    if (item.role === "teacher") return item.linked_teacher_id === currentSession.id;
    if (item.role === "participant") return item.linked_participant_id === currentSession.id;
    return false;
  });
  if (!user) {
    currentSession = publicSession();
    return;
  }
  const linkedId = user.role === "participant" ? user.linked_participant_id : user.role === "teacher" ? user.linked_teacher_id : user.id;
  currentSession = {
    role: user.role,
    id: linkedId || user.id,
    userId: user.id,
    name: user.display_name || user.login_id,
    permissions: {
      canManageMasters: Boolean(user.can_manage_masters),
      canReviewRegistrations: Boolean(user.can_review_registrations),
      canMarkAttendance: Boolean(user.can_mark_attendance)
    }
  };
}

async function fetchSupabaseRows(tableName) {
  const { data, error } = await supabaseClient.from(tableName).select("*");
  if (error) throw error;
  return data || [];
}

async function loadRelationalData() {
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
    hallBookings
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
    fetchSupabaseRows("hall_bookings")
  ]);
  const nextState = {
    programs: courseMasters.map((program) => ({
      id: program.id,
      parentId: program.parent_id || "",
      code: program.code || "",
      name: program.name,
      level: program.level || "",
      duration: program.duration || "",
      eligibility: program.eligibility || "",
      sessionTemplates: program.session_templates || []
    })),
    teachers: teachers.map((teacher) => ({
      id: teacher.id,
      name: teacher.name,
      speciality: teacher.speciality || "",
      phone: teacher.phone || "",
      email: teacher.email || "",
      photo: teacher.photo || "",
      notes: teacher.notes || ""
    })),
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
      gender: block.gender || "",
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
      gender: room.gender || "",
      beds: Number(room.beds) || 1
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
        sessions: batch.sessions || []
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
    participant.registrations.push({
      id: registration.id,
      courseId: registration.batch_id || "",
      status: registration.status || "Pending",
      eligible: Boolean(registration.eligible),
      roomId: registration.room_id || "",
      checkedIn: Boolean(registration.checked_in),
      attendance: Number(registration.attendance) || 0,
      completion: registration.completion || "Pending",
      certificate: Boolean(registration.certificate),
      sessionAttendance: registration.session_attendance || [],
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

async function persistRemoteData() {
  if (!supabaseClient || !hasLoadedRemoteData) return;
  try {
    const { error } = await supabaseClient
      .from("app_state")
      .upsert({
        id: "current",
        payload: state,
        updated_at: new Date().toISOString()
      });
    if (error) throw error;
    await syncRelationalTables();
    remoteStatus = "Supabase synced";
    renderAuthState();
  } catch (error) {
    remoteStatus = "Supabase save failed";
    renderAuthState();
    showToast(error.message || "Unable to save to Supabase.");
  }
}

async function replaceSupabaseTable(tableName, rows) {
  if (!supabaseClient) return;
  const deleteResult = await supabaseClient.from(tableName).delete().neq("id", "__none__");
  if (deleteResult.error) throw deleteResult.error;
  if (!rows.length) return;
  const insertResult = await supabaseClient.from(tableName).insert(rows);
  if (insertResult.error) throw insertResult.error;
}

async function syncRelationalTables() {
  if (!supabaseClient) return;
  const now = new Date().toISOString();
  const courseMasterRows = [...state.programs]
    .sort((a, b) => (a.parentId ? 1 : 0) - (b.parentId ? 1 : 0))
    .map((program) => ({
      id: program.id,
      parent_id: program.parentId || null,
      code: program.code || "",
      name: program.name,
      level: program.level || "",
      duration: program.duration || "",
      eligibility: program.eligibility || "",
      session_templates: program.sessionTemplates || [],
      updated_at: now
    }));
  const teacherRows = state.teachers.map((teacher) => ({
    id: teacher.id,
    name: teacher.name,
    speciality: teacher.speciality || "",
    phone: teacher.phone || "",
    email: teacher.email || "",
    photo: teacher.photo || "",
    notes: teacher.notes || "",
    updated_at: now
  }));
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
    gender: block.gender || "",
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
    gender: room.gender || "",
    beds: Number(room.beds) || 1,
    updated_at: now
  }));
  const batchRows = state.courses.map((course) => {
    const teacher = teacherByName(course.teacher);
    return {
      id: course.id,
      program_id: course.programId || null,
      name: course.name,
      start_date: course.start,
      end_date: course.end,
      seats: Number(course.seats) || 1,
      hall_id: course.hallId || null,
      teacher_id: teacher?.id || null,
      teacher_name: course.teacher || "",
      eligibility: course.eligibility || "",
      status: course.status || programLifecycleStatus(course),
      sessions: course.sessions || [],
      updated_at: now
    };
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
  const registrationRows = allRegistrationRows().map(({ participant, registration }) => ({
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
  }));
  const hallBookingRows = state.hallBookings.map((booking) => ({
    id: booking.id,
    batch_id: booking.courseId || null,
    hall_id: booking.hallId || null,
    start_date: booking.start,
    end_date: booking.end,
    notes: booking.notes || "",
    updated_at: now
  }));

  await replaceSupabaseTable("hall_bookings", []);
  await replaceSupabaseTable("registrations", []);
  await replaceSupabaseTable("batches", []);
  await replaceSupabaseTable("rooms", []);
  await replaceSupabaseTable("accommodation_floors", []);
  await replaceSupabaseTable("accommodation_blocks", []);
  await replaceSupabaseTable("participants", []);
  await replaceSupabaseTable("program_halls", []);
  await replaceSupabaseTable("teachers", []);
  await replaceSupabaseTable("course_masters", []);

  await replaceSupabaseTable("course_masters", courseMasterRows);
  await replaceSupabaseTable("teachers", teacherRows);
  await replaceSupabaseTable("program_halls", hallRows);
  await replaceSupabaseTable("accommodation_blocks", blockRows);
  await replaceSupabaseTable("accommodation_floors", floorRows);
  await replaceSupabaseTable("rooms", roomRows);
  await replaceSupabaseTable("batches", batchRows);
  await replaceSupabaseTable("participants", participantRows);
  await replaceSupabaseTable("registrations", registrationRows);
  await replaceSupabaseTable("hall_bookings", hallBookingRows);
}

function loadSession() {
  const stored = localStorage.getItem("aliyar-session");
  if (!stored) return publicSession();
  const parsed = JSON.parse(stored);
  return {
    ...publicSession(),
    ...parsed,
    permissions: { ...publicSession().permissions, ...(parsed.permissions || {}) }
  };
}

function saveSession() {
  localStorage.setItem("aliyar-session", JSON.stringify(currentSession));
}

function publicSession() {
  return {
    role: "public",
    id: "",
    userId: "",
    name: "Public Visitor",
    permissions: {
      canManageMasters: false,
      canReviewRegistrations: false,
      canMarkAttendance: false
    }
  };
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
    teacher.photo ||= "";
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
        roomId: participant.roomId,
        checkedIn: participant.checkedIn,
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
  const participantsByPhone = new Map();
  state.participants.forEach((participant) => {
    const key = participant.phone || participant.id;
    const existing = participantsByPhone.get(key);
    if (!existing) {
      participantsByPhone.set(key, participant);
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
  state.participants = Array.from(participantsByPhone.values());
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

function roomForParticipant(participant) {
  return state.rooms.find((room) => room.id === currentRegistration(participant)?.roomId) || null;
}

function registrationsForParticipant(participant) {
  return Array.isArray(participant.registrations) && participant.registrations.length
    ? participant.registrations
    : [{
      id: `reg-${participant.id}-${participant.courseId || "unassigned"}`,
      courseId: participant.courseId,
      status: participant.status,
      eligible: participant.eligible,
      roomId: participant.roomId,
      checkedIn: participant.checkedIn,
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
  participant.roomId = registration.roomId;
  participant.checkedIn = registration.checkedIn;
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
  return state.teachers.find((teacher) => teacher.name === name) || null;
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
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="180" viewBox="0 0 160 180"><rect width="160" height="180" rx="18" fill="#dff3ef"/><circle cx="80" cy="62" r="34" fill="#0f766e" opacity=".9"/><path d="M30 154c8-36 30-55 50-55s42 19 50 55" fill="#115e59" opacity=".72"/><text x="80" y="70" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700" fill="white">${initials(teacher.name)}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
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
  return roleViews[currentSession.role] || roleViews.public;
}

function defaultViewForRole(role = currentSession.role) {
  return (roleViews[role] || roleViews.public)[0] || "portal";
}

function canAccessView(viewId) {
  return allowedViews().includes(viewId);
}

function isAdmin() {
  return currentSession.role === "admin";
}

function canManageMasters() {
  return Boolean(currentSession.permissions?.canManageMasters);
}

function canReviewRegistrations() {
  return Boolean(currentSession.permissions?.canReviewRegistrations);
}

function canMarkAttendance() {
  return Boolean(currentSession.permissions?.canMarkAttendance);
}

function currentParticipant() {
  if (currentSession.role !== "participant") return null;
  return state.participants.find((participant) => participant.id === currentSession.id) || null;
}

function visibleParticipants() {
  const participant = currentParticipant();
  return participant ? [participant] : state.participants;
}

function visibleRegistrationRows() {
  const participant = currentParticipant();
  if (participant) {
    return registrationsForParticipant(participant).map((registration) => ({ participant, registration }));
  }
  return allRegistrationRows();
}

function findLoginRecord(identifier, password) {
  const value = identifier.trim().toLowerCase();
  return appUsers.find((user) => {
    const loginMatches = String(user.login_id || "").toLowerCase() === value;
    const passwordMatches = String(user.password || "") === String(password || "");
    return loginMatches && passwordMatches;
  }) || null;
}

async function login(identifier, password) {
  if (!supabaseClient) {
    showToast("Supabase is not configured. Login requires Supabase users.");
    return;
  }
  if (!hasLoadedRemoteData) {
    showToast("Supabase data is still loading. Please try again in a moment.");
    return;
  }
  await loadSupabaseUsers();
  const record = findLoginRecord(identifier, password);
  if (!record) {
    showToast("Invalid username or password.");
    return;
  }
  const role = record.role;
  const linkedId = role === "participant" ? record.linked_participant_id : role === "teacher" ? record.linked_teacher_id : record.id;
  currentSession = {
    role,
    id: linkedId || record.id,
    userId: record.id,
    name: record.display_name || record.login_id,
    permissions: {
      canManageMasters: Boolean(record.can_manage_masters),
      canReviewRegistrations: Boolean(record.can_review_registrations),
      canMarkAttendance: Boolean(record.can_mark_attendance)
    }
  };
  selectedParticipantId = role === "participant" ? currentSession.id : selectedParticipantId;
  selectedTeacherId = role === "teacher" ? currentSession.id : selectedTeacherId;
  linkBackStack = [];
  renderNav();
  renderAll();
  activateView(defaultViewForRole(role));
  showToast(`Logged in as ${currentSession.name}.`);
}

function logout() {
  currentSession = publicSession();
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
    return {
      programName: courseMaster?.name || "Not mapped",
      batchName: batch?.name || "Unassigned",
      courseId: registration.courseId,
      start: batch?.start || "",
      end: batch?.end || "",
      completion: registration.completion,
      attendance: registration.attendance,
      certificate: registration.certificate,
      accommodation: roomName(registration.roomId)
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
  return programLifecycleStatus(course) !== "Completed";
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function newId(prefix) {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 10000)}`;
}

function renderNav() {
  const permitted = allowedViews();
  $("#nav").innerHTML = views
    .filter(([id]) => permitted.includes(id))
    .map(([id, label]) => `<button type="button" data-view="${id}" class="${id === currentViewId() ? "is-active" : ""}">${label}</button>`)
    .join("");
  $("#nav").onclick = (event) => {
    const button = event.target.closest("button[data-view]");
    if (button) activateView(button.dataset.view);
  };
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
    selectedParticipantId,
    selectedTeacherId,
    viewId: currentViewId()
  };
}

function restoreSelectionState(stateSnapshot) {
  selectedCourseId = stateSnapshot.selectedCourseId;
  selectedParticipantId = stateSnapshot.selectedParticipantId;
  selectedTeacherId = stateSnapshot.selectedTeacherId;
  activateView(stateSnapshot.viewId);
  renderAll();
}

function openLinkedRecord(viewId, selections = {}, label = "Back") {
  linkBackStack.push(currentSelectionState(label));
  if (selections.courseId) selectedCourseId = selections.courseId;
  if (selections.participantId) selectedParticipantId = selections.participantId;
  if (selections.teacherId) selectedTeacherId = selections.teacherId;
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
  const upcomingPrograms = state.courses.filter(isPortalProgram);
  const rows = upcomingPrograms.map((course) => {
    const registered = allRegistrationRows().filter(({ registration }) => registration.courseId === course.id).length;
    const teacher = teacherByName(course.teacher);
    return `<tr>
      <td><strong>${course.name}</strong><br><span class="muted">${course.eligibility}</span><br><span class="pill ${statusClass(course.status || programLifecycleStatus(course))}">${course.status || programLifecycleStatus(course)}</span></td>
      <td>${course.start}<br><span class="muted">${course.end}</span></td>
      <td>${teacher ? `<button class="text-link-button" type="button" data-linked-teacher="${teacher.id}">${course.teacher}</button>` : course.teacher}</td>
      <td>${registered}/${course.seats}</td>
      <td>${course.hall}</td>
      <td><button class="secondary-button" type="button" data-public-register="${course.id}">Register</button></td>
    </tr>`;
  }).join("");
  $("#portalBatchRows").innerHTML = rows || `<tr><td colspan="6"><span class="muted">No upcoming programs are open for registration.</span></td></tr>`;
}

function renderPermissionChrome() {
  const adminControls = [
    "#addProgram",
    "#addCourse",
    "#addTeacherFromView",
    "#addAccommodationRecord",
    "#autoAssign",
    "#addHall",
    "#addHallBooking",
    "#generateCertificates"
  ];
  adminControls.forEach((selector) => {
    const element = $(selector);
    if (element) element.hidden = !canManageMasters();
  });
  const registrationButtons = ["#openRegistration", "#portalRegistration", "#addParticipantFromMaster"];
  registrationButtons.forEach((selector) => {
    const element = $(selector);
    if (element) element.hidden = currentSession.role === "participant";
  });
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
  const today = new Date();
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  $("#calendarTitle").textContent = formatMonthTitle(calendarDate);
  const header = weekdays.map((day) => `<div class="calendar-weekday">${day}</div>`).join("");
  const cells = Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - startOffset + 1;
    if (dayNumber < 1 || dayNumber > daysInMonth) {
      return `<div class="calendar-day is-empty"></div>`;
    }
    const date = new Date(year, month, dayNumber);
    const programs = state.courses.filter((course) => {
      const start = new Date(`${course.start}T00:00:00`);
      const end = new Date(`${course.end}T00:00:00`);
      return isDateInRange(date, start, end);
    });
    return `<div class="calendar-day ${isSameDate(date, today) ? "is-today" : ""}">
      <div class="calendar-date">${dayNumber}</div>
      <div class="calendar-programs">
        ${programs.map((course) => {
          const start = new Date(`${course.start}T00:00:00`);
          const end = new Date(`${course.end}T00:00:00`);
          const marker = isSameDate(date, start) ? "Starts" : isSameDate(date, end) ? "Ends" : "Runs";
          return `<button class="calendar-program" type="button" data-course-open="${course.id}" title="${course.name}">
            <span>${marker}</span>${course.name}
          </button>`;
        }).join("")}
      </div>
    </div>`;
  }).join("");
  $("#programCalendar").innerHTML = header + cells;
}

function renderCourses() {
  if (!selectedCourseId || !state.courses.some((course) => course.id === selectedCourseId)) {
    selectedCourseId = state.courses[0]?.id || "";
  }
  $("#batchRows").innerHTML = state.courses.map((course) => {
    const registered = allRegistrationRows().filter(({ registration }) => registration.courseId === course.id).length;
    const sessions = courseSessionPlan(course.id);
    const status = course.status || programLifecycleStatus(course);
    return `
      <tr class="batch-master-row ${selectedCourseId === course.id ? "participant-row-selected" : ""}" data-batch-view="${course.id}" tabindex="0">
        <td><strong>${course.name}</strong><br><span class="muted">${course.eligibility} | ${sessions.length} session(s)</span><br><span class="pill ${statusClass(status)}">${status}</span></td>
        <td>${course.start}<br><span class="muted">${course.end}</span></td>
        <td>${teacherByName(course.teacher) ? `<button class="text-link-button" type="button" data-linked-teacher="${teacherByName(course.teacher).id}">${course.teacher}</button>` : course.teacher}</td>
        <td>${registered}/${course.seats}</td>
        <td>${course.hall}</td>
      </tr>
    `;
  }).join("");
  renderBatchDetail();
}

function renderBatchDetail() {
  const course = state.courses.find((item) => item.id === selectedCourseId);
  if (!course) {
    $("#batchDetail").innerHTML = `<p class="muted">No programs scheduled yet.</p>`;
    return;
  }
  const registered = allRegistrationRows().filter(({ registration }) => registration.courseId === course.id).length;
  const attendanceRows = currentSession.role === "participant"
    ? visibleRegistrationRows().filter(({ registration }) => registration.courseId === course.id && registration.status === "Confirmed")
    : registrationRowsForCourse(course.id);
  const sessions = courseSessionPlan(course.id);
  const completedCount = attendanceRows.filter(({ registration }) => registration.completion === "Completed").length;
  const teacher = teacherByName(course.teacher);
  const status = course.status || programLifecycleStatus(course);
  const showBatchActions = canManageMasters();
  const showRegistrationAction = currentSession.role !== "participant" && status !== "Completed";
  const allowAttendance = canMarkAttendance();
  $("#batchDetail").innerHTML = `
    ${backLinkHtml()}
    <div class="batch-detail-heading">
      <div>
        <h3>${course.name}</h3>
        <p class="muted">${course.eligibility} | ${status}</p>
      </div>
      <div class="row-actions">
        ${showBatchActions ? `<button class="primary-button" type="button" data-apply-course-sessions="${course.id}">Apply Course Sessions</button>` : ""}
        ${showRegistrationAction ? `<button class="secondary-button" type="button" data-course-register="${course.id}">Register Participant</button>` : ""}
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
              ${sessions.map((session, index) => `<th>S${index + 1}<br><span class="muted">${session.date.slice(5)} | ${session.title}</span></th>`).join("")}
              <th>Completion</th>
            </tr>
          </thead>
          <tbody>
            ${attendanceRows.length ? attendanceRows.map(({ participant, registration }) => `
              <tr>
                <td><strong><button class="text-link-button" type="button" data-linked-participant="${participant.id}">${participant.name}</button></strong><br><span class="muted">${participant.phone}</span></td>
                ${sessions.map((session) => {
                  const record = attendanceForSession(registration, session.id);
                  const locked = hasEarlierSessionAbsence(registration, session.id);
                  return `<td>
                    <div class="attendance-cell">
                      <span class="pill ${statusClass(record?.status || "mark")}">${record?.status || "Mark"}</span>
                      <small>${session.time}<br>${session.topic}</small>
                      ${record?.reason ? `<small>${record.reason}</small>` : ""}
                      ${allowAttendance ? `<div class="attendance-actions">
                        <button type="button" data-attendance-status="Present" data-id="${participant.id}" data-registration-id="${registration.id}" data-session-id="${session.id}" onclick="markSessionAttendance('${participant.id}', '${registration.id}', '${session.id}', 'Present')" ${locked ? "disabled" : ""}>P</button>
                        <button type="button" data-attendance-status="Late" data-id="${participant.id}" data-registration-id="${registration.id}" data-session-id="${session.id}" onclick="markSessionAttendance('${participant.id}', '${registration.id}', '${session.id}', 'Late')" ${locked ? "disabled" : ""}>L</button>
                        <button type="button" data-attendance-status="Absent" data-id="${participant.id}" data-registration-id="${registration.id}" data-session-id="${session.id}" onclick="markSessionAttendance('${participant.id}', '${registration.id}', '${session.id}', 'Absent')" ${locked ? "disabled" : ""}>A</button>
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
  const childrenFor = (parentId) => state.programs.filter((program) => program.parentId === parentId);
  const renderNode = (program) => {
    const children = childrenFor(program.id);
    return `<div class="program-node ${program.parentId ? "is-child" : "is-parent"}">
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
  $("#programRows").innerHTML = state.programs.map((program) => `
    <tr>
      <td><strong>${program.name}</strong><br><span class="muted">${program.parentId ? `Under ${state.programs.find((item) => item.id === program.parentId)?.name || "Root"}` : "Root course family"}</span></td>
      <td>${program.code}</td>
      <td>${program.level}</td>
      <td>${program.duration || "<span class=\"muted\">Varies</span>"}</td>
      <td>${program.eligibility}</td>
      <td>
        <div class="row-actions">
          <button class="secondary-button" type="button" data-program-edit="${program.id}">Edit</button>
          ${program.parentId ? `<button class="secondary-button" type="button" data-program-session-add="${program.id}">Add Session</button>` : ""}
          <button class="danger-button" type="button" data-program-delete="${program.id}">Delete</button>
        </div>
      </td>
    </tr>
    ${program.parentId ? `<tr><td colspan="6">
      <div class="session-template-list">
        <strong>Course Session Plan</strong>
        ${(program.sessionTemplates || []).map((session) => `
          <div class="session-template-row">
            <span>Day ${session.day} | ${session.time} | ${session.title} | ${session.topic}</span>
            <span class="row-actions">
              <button class="secondary-button" type="button" data-program-session-edit="${program.id}" data-session-template-id="${session.id}">Edit</button>
              <button class="danger-button" type="button" data-program-session-delete="${program.id}" data-session-template-id="${session.id}">Delete</button>
            </span>
          </div>
        `).join("") || "<span class=\"muted\">No sessions planned.</span>"}
      </div>
    </td></tr>` : ""}
  `).join("");
}

function renderTeachers() {
  const teachers = currentSession.role === "teacher"
    ? state.teachers.filter((teacher) => teacher.id === currentSession.id)
    : state.teachers;
  if (!selectedTeacherId || !teachers.some((teacher) => teacher.id === selectedTeacherId)) {
    selectedTeacherId = teachers[0]?.id || "";
  }
  $("#teacherRows").innerHTML = teachers.map((teacher) => {
    const programs = state.courses.filter((course) => course.teacher === teacher.name);
    return `
      <tr class="teacher-master-row ${teacher.id === selectedTeacherId ? "participant-row-selected" : ""}" data-teacher-view="${teacher.id}" tabindex="0">
        <td><strong>${teacher.name}</strong><br><span class="muted">${teacher.email}</span></td>
        <td>${teacher.speciality}</td>
        <td>${teacher.phone}<br><span class="muted">${teacher.email}</span></td>
        <td>${programs.length ? programs.map((course) => `<span class="pill">${course.name}</span>`).join(" ") : "<span class=\"muted\">No programs assigned</span>"}</td>
        <td>
          ${canManageMasters() ? `<div class="row-actions">
            <button class="secondary-button" type="button" data-teacher-edit="${teacher.id}">Edit</button>
            <button class="danger-button" type="button" data-teacher-delete="${teacher.id}">Delete</button>
          </div>` : "<span class=\"muted\">View only</span>"}
        </td>
      </tr>
    `;
  }).join("");
  const selected = teachers.find((teacher) => teacher.id === selectedTeacherId);
  if (!selected) {
    $("#teacherDetail").innerHTML = `<p class="muted">No teachers recorded yet.</p>`;
    return;
  }
  const conducted = state.courses.filter((course) => course.teacher === selected.name);
  $("#teacherDetail").innerHTML = `
    ${backLinkHtml()}
    <div class="profile-card">
      <img class="profile-photo" src="${teacherPhoto(selected)}" alt="${selected.name} profile photo">
      <div class="profile-summary">
        <div class="participant-detail-heading">
          <div>
            <h3>${selected.name}</h3>
            <p class="muted">${selected.email} | ${selected.phone}</p>
          </div>
          <span class="pill">${conducted.length} program(s)</span>
        </div>
        <div class="profile-meta">
          <span>${selected.speciality}</span>
        </div>
      </div>
    </div>
    <div class="detail-grid">
      <div class="detail-item"><span>Phone</span><strong>${selected.phone}</strong></div>
      <div class="detail-item"><span>Email</span><strong>${selected.email}</strong></div>
      <div class="detail-item detail-item-wide"><span>Notes</span><strong>${selected.notes || "No notes recorded."}</strong></div>
    </div>
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
  $("#participantMasterRows").innerHTML = participants.map((participant) => {
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
  }).join("");

  const selected = participants.find((participant) => participant.id === selectedParticipantId);
  if (!selected) {
    $("#participantDetail").innerHTML = `<p class="muted">No participants recorded yet.</p>`;
    return;
  }
  const batch = batchForParticipant(selected);
  const courseMaster = courseMasterForBatch(batch);
  const room = roomForParticipant(selected);
  const roomOccupants = room ? state.participants.filter((participant) => currentRegistration(participant)?.roomId === room.id).length : 0;
  const registration = currentRegistration(selected);
  const programsAttended = participantProgramHistory(selected);
  $("#participantDetail").innerHTML = `
    ${backLinkHtml()}
    <div class="profile-card">
      <img class="profile-photo" src="${participantPhoto(selected)}" alt="${selected.name} profile photo">
      <div class="profile-summary">
        <div class="participant-detail-heading">
          <div>
            <h3>${selected.name}</h3>
            <p class="muted">${selected.email} | ${selected.phone}</p>
          </div>
          <span class="pill ${statusClass(registration.completion)}">${registration.completion}</span>
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
      <div class="detail-item"><span>Latest Registration</span><strong>${registration.status}</strong></div>
      <div class="detail-item"><span>Phone</span><strong>${selected.phone}</strong></div>
      <div class="detail-item"><span>Email</span><strong>${selected.email}</strong></div>
      <div class="detail-item"><span>Emergency Contact</span><strong>${selected.emergencyContact || "Not recorded"}</strong></div>
      <div class="detail-item"><span>Address</span><strong>${selected.address || "Not recorded"}</strong></div>
      <div class="detail-item"><span>Course Master</span><strong>${courseMaster?.name || "Not mapped"}</strong></div>
      <div class="detail-item"><span>Program</span><strong>${batch?.name || "Unassigned"}</strong></div>
      <div class="detail-item"><span>Program Dates</span><strong>${batch ? `${batch.start} to ${batch.end}` : "Not scheduled"}</strong></div>
      <div class="detail-item"><span>Eligibility</span><strong>${registration.eligible ? "Verified" : "Needs review"}</strong></div>
      <div class="detail-item"><span>Course Completion</span><strong>${registration.completion}</strong></div>
      <div class="detail-item"><span>Attendance</span><strong>${registration.attendance} sessions</strong></div>
      <div class="detail-item"><span>Certificate</span><strong>${registration.certificate ? "Issued" : "Pending"}</strong></div>
      <div class="detail-item"><span>Accommodation Details</span><strong>${room?.name || "Not assigned"}</strong></div>
      <div class="detail-item"><span>Room Type</span><strong>${room ? `${room.gender} | ${roomOccupants}/${room.beds} beds used` : "Not assigned"}</strong></div>
      <div class="detail-item"><span>Check-In</span><strong>${registration.checkedIn ? "Checked in" : "Not checked in"}</strong></div>
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
              <th>Program</th>
              <th>Program</th>
              <th>Dates</th>
              <th>Status</th>
              <th>Attendance</th>
              <th>Certificate</th>
              <th>Accommodation</th>
            </tr>
          </thead>
          <tbody>
            ${programsAttended.map((program) => `
              <tr>
                <td>${program.programName}</td>
                <td>${program.courseId ? `<button class="text-link-button" type="button" data-linked-batch="${program.courseId}">${program.batchName}</button>` : program.batchName}</td>
                <td>${program.start && program.end ? `${program.start}<br>${program.end}` : "Not scheduled"}</td>
                <td><span class="pill ${statusClass(program.completion)}">${program.completion}</span></td>
                <td>${program.attendance} sessions</td>
                <td>${program.certificate ? "Issued" : "Pending"}</td>
                <td>${program.accommodation}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderRegistrations() {
  const search = $("#globalSearch").value.trim().toLowerCase();
  let rows = visibleRegistrationRows().filter(({ registration }) => currentFilter === "all" || registration.status === currentFilter);
  if (search) {
    rows = rows.filter(({ participant, registration }) => [participant.name, participant.email, participant.phone, participant.id, courseName(registration.courseId), roomName(registration.roomId)].join(" ").toLowerCase().includes(search));
  }
  const showActions = canReviewRegistrations();
  $("#participantRows").innerHTML = rows.map(({ participant, registration }) => `
    <tr>
      <td><strong><button class="text-link-button" type="button" data-linked-participant="${participant.id}">${participant.name}</button></strong><br><span class="muted">${participant.id} | ${participant.phone}</span></td>
      <td><button class="text-link-button" type="button" data-linked-batch="${registration.courseId}">${courseName(registration.courseId)}</button><br><span class="muted">${registration.registeredOn || "Registration date not set"}</span></td>
      <td><span class="pill ${statusClass(registration.status)}">${registration.status}</span></td>
      <td>${registration.eligible ? "Verified" : "Needs review"}</td>
      <td>${roomName(registration.roomId)}</td>
      <td>
        ${!showActions || registration.status === "Confirmed" ? "<span class=\"muted\">No further actions</span>" : `
          <div class="row-actions">
            <button class="secondary-button" type="button" data-action="eligible" data-id="${participant.id}" data-registration-id="${registration.id}">Verify</button>
            <button class="secondary-button" type="button" data-action="confirm" data-id="${participant.id}" data-registration-id="${registration.id}">Confirm</button>
            <button class="secondary-button" type="button" data-action="waitlist" data-id="${participant.id}" data-registration-id="${registration.id}">Waitlist</button>
          </div>
        `}
      </td>
    </tr>
  `).join("");
}

function renderRooms() {
  const blockRows = state.blocks.map((block) => {
    const floors = state.floors.filter((floor) => floor.blockId === block.id).length;
    const rooms = state.rooms.filter((room) => room.blockId === block.id).length;
    return `<tr>
      <td><strong>${block.name}</strong><br><span class="muted">${block.notes || "No notes"}</span></td>
      <td>${block.gender}</td>
      <td>${floors}</td>
      <td>${rooms}</td>
      <td><div class="row-actions"><button class="secondary-button" type="button" data-block-edit="${block.id}">Edit</button><button class="danger-button" type="button" data-block-delete="${block.id}">Delete</button></div></td>
    </tr>`;
  }).join("");
  const floorRows = state.floors.map((floor) => `
    <tr>
      <td><strong>${floor.name}</strong></td>
      <td>${blockName(floor.blockId)}</td>
      <td>${state.rooms.filter((room) => room.floorId === floor.id).length}</td>
      <td><div class="row-actions"><button class="secondary-button" type="button" data-floor-edit="${floor.id}">Edit</button><button class="danger-button" type="button" data-floor-delete="${floor.id}">Delete</button></div></td>
    </tr>
  `).join("");
  const roomRows = state.rooms.map((room) => {
    const guests = state.participants.filter((p) => currentRegistration(p)?.roomId === room.id);
    const percent = Math.round((guests.length / room.beds) * 100);
    return `<tr>
      <td><strong>${room.name}</strong><br><span class="muted">${guests.length ? guests.map((guest) => guest.name).join(", ") : "No guests assigned"}</span></td>
      <td>${blockName(room.blockId)}</td>
      <td>${floorName(room.floorId)}</td>
      <td>${room.gender}</td>
      <td>${guests.length}/${room.beds}<div class="bed-bar compact-bed-bar"><span style="width:${Math.min(percent, 100)}%"></span></div></td>
      <td><div class="row-actions"><button class="secondary-button" type="button" data-room-edit="${room.id}">Edit</button><button class="danger-button" type="button" data-room-delete="${room.id}">Delete</button></div></td>
    </tr>`;
  }).join("");
  $("#accommodationContent").innerHTML = accommodationTab === "blocks" ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Block</th><th>Gender</th><th>Floors</th><th>Rooms</th><th>Actions</th></tr></thead>
        <tbody>${blockRows}</tbody>
      </table>
    </div>
  ` : `
    <div class="table-wrap accommodation-subtable">
      <table>
        <thead><tr><th>Floor</th><th>Block</th><th>Rooms</th><th>Actions</th></tr></thead>
        <tbody>${floorRows}</tbody>
      </table>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Room</th><th>Block</th><th>Floor</th><th>Type</th><th>Occupancy</th><th>Actions</th></tr></thead>
        <tbody>${roomRows}</tbody>
      </table>
    </div>
  `;
  $$("#accommodationTabs button").forEach((button) => button.classList.toggle("is-selected", button.dataset.accommodationTab === accommodationTab));
}

function renderHalls() {
  const hallRows = state.halls.map((hall) => `
    <tr>
      <td><strong>${hall.name}</strong></td>
      <td>${hall.capacity}</td>
      <td>${hall.location}</td>
      <td>${hall.notes || "<span class=\"muted\">No notes</span>"}</td>
      <td><div class="row-actions"><button class="secondary-button" type="button" data-hall-edit="${hall.id}">Edit</button><button class="danger-button" type="button" data-hall-delete="${hall.id}">Delete</button></div></td>
    </tr>
  `).join("");
  const bookingRows = state.hallBookings.map((booking) => `
    <tr>
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
        <tbody>${hallRows}</tbody>
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
        <tbody>${bookingRows}</tbody>
      </table>
    </div>
  `;
  $$("#hallTabs button").forEach((button) => button.classList.toggle("is-selected", button.dataset.hallTab === hallTab));
}

function renderHallBookings() {
  renderHalls();
}

function renderCertificates() {
  $("#certificateList").innerHTML = state.participants.map((p) => {
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
  const registrationPrograms = state.courses.filter(isPortalProgram);
  $("#courseSelect").innerHTML = registrationPrograms.map((course) => `<option value="${course.id}">${course.name}</option>`).join("");
  $("#hallSelect").innerHTML = state.halls.map((hall) => `<option value="${hall.id}">${hall.name} (${hall.capacity})</option>`).join("");
  $("#batchProgramSelect").innerHTML = state.programs
    .filter((program) => program.parentId)
    .map((program) => `<option value="${program.id}">${program.name}</option>`)
    .join("");
}

function renderProgramParentOptions(currentId = "") {
  const options = state.programs
    .filter((program) => program.id !== currentId)
    .map((program) => `<option value="${program.id}">${program.name}</option>`)
    .join("");
  $("#programParentSelect").innerHTML = `<option value="">No parent / root course</option>${options}`;
}

function renderAll() {
  applyProgramLifecycleStatuses();
  saveData();
  saveSession();
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
  renderHalls();
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
  if (hasEarlierSessionAbsence(registration, sessionId)) {
    showToast("Cannot mark further attendance after an absence.");
    return;
  }
  const needsReason = status === "Late" || status === "Absent";
  if (needsReason && !reason) {
    openAttendanceReasonDialog(participantId, registrationId, sessionId, status);
    return;
  }
  const existing = attendanceForSession(registration, sessionId);
  if (existing) {
    existing.status = status;
    existing.reason = reason;
  } else {
    registration.sessionAttendance.push({ sessionId, status, reason });
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
    const teacher = state.teachers.find((item) => item.id === teacherId);
    if (!teacher) return;
    $("#teacherDialogTitle").textContent = "Edit Teacher";
    form.elements.name.value = teacher.name;
    form.elements.speciality.value = teacher.speciality;
    form.elements.phone.value = teacher.phone;
    form.elements.email.value = teacher.email;
    form.elements.notes.value = teacher.notes || "";
  } else {
    $("#teacherDialogTitle").textContent = "Add Teacher";
  }
  $("#teacherDialog").showModal();
}

function deleteTeacher(teacherId) {
  const teacher = state.teachers.find((item) => item.id === teacherId);
  if (!teacher) return;
  const assigned = state.courses.filter((course) => course.teacher === teacher.name).length;
  if (assigned > 0) {
    showToast("Cannot delete a teacher assigned to scheduled programs.");
    return;
  }
  state.teachers = state.teachers.filter((item) => item.id !== teacherId);
  renderAll();
  showToast("Teacher deleted.");
}

function addOrEditBlock(blockId = "") {
  const block = state.blocks.find((item) => item.id === blockId);
  openRecordDialog("block", blockId, "Accommodation", block ? "Edit Block" : "Add Block", [
    ["name", "Block Name", block?.name || "", "text"],
    ["gender", "Gender Type", block?.gender || "Female", "text"],
    ["notes", "Notes", block?.notes || "", "textarea"]
  ]);
}

function addOrEditRoom(roomId = "") {
  const room = state.rooms.find((item) => item.id === roomId);
  openRecordDialog("room", roomId, "Accommodation", room ? "Edit Room" : "Add Room", [
    ["name", "Room Name", room?.name || "", "text"],
    ["blockId", "Block ID", room?.blockId || state.blocks[0]?.id || "", "text", state.blocks.map((block) => `${block.id}: ${block.name}`).join(" | ")],
    ["floorId", "Floor ID", room?.floorId || state.floors[0]?.id || "", "text", state.floors.map((floor) => `${floor.id}: ${floor.name}`).join(" | ")],
    ["gender", "Room Type", room?.gender || "Female", "text"],
    ["beds", "Beds", room?.beds || "4", "number"]
  ]);
}

function addOrEditFloor(floorId = "") {
  const floor = state.floors.find((item) => item.id === floorId);
  openRecordDialog("floor", floorId, "Accommodation", floor ? "Edit Floor" : "Add Floor", [
    ["name", "Floor Name", floor?.name || "", "text"],
    ["blockId", "Block ID", floor?.blockId || state.blocks[0]?.id || "", "text", state.blocks.map((block) => `${block.id}: ${block.name}`).join(" | ")]
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

function deleteProgramSession(programId, sessionId) {
  const program = state.programs.find((item) => item.id === programId);
  if (!program) return;
  program.sessionTemplates = (program.sessionTemplates || []).filter((session) => session.id !== sessionId);
  applyProgramPlanToBatches(programId);
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
    const payload = { name: data.get("name").trim(), gender: data.get("gender").trim(), notes: data.get("notes").trim() };
    if (record) Object.assign(record, payload);
    else state.blocks.push({ id: newId("block"), ...payload });
  }
  if (mode === "floor") {
    const record = state.floors.find((item) => item.id === id);
    const payload = { name: data.get("name").trim(), blockId: data.get("blockId").trim() };
    if (record) Object.assign(record, payload);
    else state.floors.push({ id: newId("floor"), ...payload });
  }
  if (mode === "room") {
    const record = state.rooms.find((item) => item.id === id);
    const payload = { name: data.get("name").trim(), blockId: data.get("blockId").trim(), floorId: data.get("floorId").trim(), gender: data.get("gender").trim(), beds: Number(data.get("beds")) || 1 };
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

function deleteBlock(blockId) {
  if (state.rooms.some((room) => room.blockId === blockId)) {
    showToast("Cannot delete a block with rooms.");
    return;
  }
  state.blocks = state.blocks.filter((block) => block.id !== blockId);
  state.floors = state.floors.filter((floor) => floor.blockId !== blockId);
  renderAll();
}

function deleteRoom(roomId) {
  if (state.participants.some((participant) => currentRegistration(participant)?.roomId === roomId)) {
    showToast("Cannot delete an occupied room.");
    return;
  }
  state.rooms = state.rooms.filter((room) => room.id !== roomId);
  renderAll();
}

function deleteFloor(floorId) {
  if (state.rooms.some((room) => room.floorId === floorId)) {
    showToast("Cannot delete a floor with rooms.");
    return;
  }
  state.floors = state.floors.filter((floor) => floor.id !== floorId);
  renderAll();
}

function deleteHall(hallId) {
  if (state.hallBookings.some((booking) => booking.hallId === hallId)) {
    showToast("Cannot delete a hall with bookings.");
    return;
  }
  state.halls = state.halls.filter((hall) => hall.id !== hallId);
  renderAll();
}

function deleteHallBooking(bookingId) {
  state.hallBookings = state.hallBookings.filter((booking) => booking.id !== bookingId);
  renderAll();
}

function openProgramDialog(programId = "") {
  const form = $("#programForm");
  form.reset();
  form.elements.id.value = programId;
  renderProgramParentOptions(programId);
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
  } else {
    $("#programDialogTitle").textContent = "Add Course";
  }
  $("#programDialog").showModal();
}

function deleteProgram(programId) {
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
  renderAll();
  showToast("Course deleted.");
}

function bindEvents() {
  $("#openRegistration").addEventListener("click", () => $("#registrationDialog").showModal());
  $("#portalRegistration").addEventListener("click", () => $("#registrationDialog").showModal());
  $("#addCourse").addEventListener("click", () => canManageMasters() && $("#courseDialog").showModal());
  $("#addProgram").addEventListener("click", () => canManageMasters() && openProgramDialog());
  $("#addTeacherFromView").addEventListener("click", () => canManageMasters() && openTeacherDialog());
  $("#addParticipantFromMaster").addEventListener("click", () => $("#registrationDialog").showModal());
  $("#previousMonth").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1);
    renderCalendar();
  });
  $("#nextMonth").addEventListener("click", () => {
    calendarDate = new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1);
    renderCalendar();
  });
  $("#autoAssign").addEventListener("click", () => canManageMasters() && assignRooms());
  $("#addAccommodationRecord").addEventListener("click", () => {
    if (!canManageMasters()) return;
    if (accommodationTab === "blocks") {
      addOrEditBlock();
      return;
    }
    const type = (window.prompt("Add Floor or Room?", "Room") || "").toLowerCase();
    if (type.startsWith("f")) addOrEditFloor();
    else addOrEditRoom();
  });
  $("#addHall").addEventListener("click", () => canManageMasters() && addOrEditHall());
  $("#addHallBooking").addEventListener("click", () => canManageMasters() && addOrEditHallBooking());
  $("#generateCertificates").addEventListener("click", () => canManageMasters() && generateCertificates());
  $("#globalSearch").addEventListener("input", renderRegistrations);
  $("#registrationFilter").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    currentFilter = button.dataset.filter;
    $$("#registrationFilter button").forEach((item) => item.classList.toggle("is-selected", item === button));
    renderRegistrations();
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
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await login(form.get("identifier"), form.get("password"));
    event.currentTarget.reset();
  });
  document.body.addEventListener("click", (event) => {
    const logoutButton = event.target.closest("#logoutButton");
    if (logoutButton) {
      logout();
      return;
    }
    const publicRegister = event.target.closest("[data-public-register]");
    if (publicRegister) {
      const course = state.courses.find((item) => item.id === publicRegister.dataset.publicRegister);
      if (!course || !isPortalProgram(course)) {
        showToast("Registration is open only for upcoming programs.");
        return;
      }
      $("#courseSelect").value = publicRegister.dataset.publicRegister;
      $("#registrationDialog").showModal();
      return;
    }
    const cancelRegistration = event.target.closest("#closeRegistration, #cancelRegistration");
    if (cancelRegistration) {
      event.preventDefault();
      $("#registrationDialog").close();
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
    const cancelRecord = event.target.closest("#closeRecord, #cancelRecord");
    if (cancelRecord) {
      event.preventDefault();
      $("#recordDialog").close();
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
      openLinkedRecord("courses", { courseId: openedCourseId }, "Back to Dashboard");
      requestAnimationFrame(() => {
        document.querySelector(`[data-batch-view="${openedCourseId}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    const linkBack = event.target.closest("[data-link-back]");
    if (linkBack) {
      const previous = linkBackStack.pop();
      if (previous) restoreSelectionState(previous);
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
      if (!canManageMasters()) return;
      openTeacherDialog(editTeacher.dataset.teacherEdit);
      return;
    }
    const deleteTeacherButton = event.target.closest("[data-teacher-delete]");
    if (deleteTeacherButton) {
      if (!canManageMasters()) return;
      deleteTeacher(deleteTeacherButton.dataset.teacherDelete);
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
    const applyCourseSessionsButton = event.target.closest("[data-apply-course-sessions]");
    if (applyCourseSessionsButton) {
      if (!canManageMasters()) return;
      applyCourseSessionPlan(applyCourseSessionsButton.dataset.applyCourseSessions);
      return;
    }
    const teacherView = event.target.closest("[data-teacher-view]");
    if (teacherView && !event.target.closest("button")) {
      selectedTeacherId = teacherView.dataset.teacherView;
      renderTeachers();
      return;
    }
    const participantView = event.target.closest("[data-participant-view]");
    if (participantView) {
      selectedParticipantId = participantView.dataset.participantView;
      renderParticipantsMaster();
      return;
    }
    const registerButton = event.target.closest("[data-course-register]");
    if (registerButton) {
      if (currentSession.role === "participant") {
        showToast("Logout to use public registration.");
        return;
      }
      const course = state.courses.find((item) => item.id === registerButton.dataset.courseRegister);
      if (!course || !isPortalProgram(course)) {
        showToast("Registration is open only for upcoming programs.");
        return;
      }
      $("#courseSelect").value = registerButton.dataset.courseRegister;
      $("#registrationDialog").showModal();
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
      if (type === "eligible") updateRegistration(id, registrationId, (registration) => registration.eligible = true, "Eligibility verified.");
      if (type === "confirm") updateRegistration(id, registrationId, (registration) => { registration.status = "Confirmed"; registration.eligible = true; }, "Registration confirmed.");
      if (type === "waitlist") updateRegistration(id, registrationId, (registration) => registration.status = "Waitlist", "Participant moved to waitlist.");
      return;
    }
    if (type === "checkin") updateParticipant(id, (p) => p.checkedIn = true, "Participant checked in.");
    if (type === "attend") updateParticipant(id, (p) => p.attendance += 1, "Attendance recorded.");
    if (type === "complete") updateParticipant(id, (p) => p.completion = "Completed", "Completion approved.");
    if (type === "dropout") updateParticipant(id, (p) => p.completion = "Dropout", "Dropout recorded.");
  });
  document.body.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const batchView = event.target.closest("[data-batch-view]");
    if (batchView) {
      event.preventDefault();
      selectedCourseId = batchView.dataset.batchView;
      renderCourses();
      return;
    }
    const teacherView = event.target.closest("[data-teacher-view]");
    if (teacherView) {
      event.preventDefault();
      selectedTeacherId = teacherView.dataset.teacherView;
      renderTeachers();
      return;
    }
    const participantView = event.target.closest("[data-participant-view]");
    if (!participantView) return;
    event.preventDefault();
    selectedParticipantId = participantView.dataset.participantView;
    renderParticipantsMaster();
  });
  $("#registrationForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const phone = form.get("phone").trim();
    const courseId = form.get("course");
    const registration = {
      id: newId("registration"),
      courseId,
      status: "Pending",
      eligible: false,
      roomId: "",
      checkedIn: false,
      attendance: 0,
      completion: "Pending",
      certificate: false,
      sessionAttendance: [],
      notes: form.get("notes"),
      registeredOn: new Date().toISOString().slice(0, 10)
    };
    let participant = state.participants.find((item) => item.phone === phone || item.id === phone);
    if (participant) {
      participant.name = form.get("name").trim() || participant.name;
      participant.age = Number(form.get("age")) || participant.age;
      participant.gender = form.get("gender") || participant.gender;
      participant.email = form.get("email").trim() || participant.email;
      participant.photo = form.get("photo").trim() || participant.photo || "";
      participant.address = form.get("address").trim() || participant.address || "";
      participant.emergencyContact = form.get("emergencyContact").trim() || participant.emergencyContact || "";
      participant.notes = form.get("notes") || participant.notes || "";
      registrationsForParticipant(participant).push(registration);
      syncParticipantFromRegistration(participant, registration);
    } else {
      participant = {
        id: newId("participant"),
        name: form.get("name").trim(),
        age: Number(form.get("age")),
        gender: form.get("gender"),
        courseId,
        phone,
        email: form.get("email").trim(),
        photo: form.get("photo").trim(),
        address: form.get("address").trim(),
        emergencyContact: form.get("emergencyContact").trim(),
        status: registration.status,
        eligible: registration.eligible,
        roomId: registration.roomId,
        checkedIn: registration.checkedIn,
        attendance: registration.attendance,
        completion: registration.completion,
        certificate: registration.certificate,
        programHistory: [],
        notes: form.get("notes"),
        registrations: [registration]
      };
      state.participants.push(participant);
    }
    selectedParticipantId = participant.id;
    event.currentTarget.reset();
    $("#registrationDialog").close();
    activateView("registrations");
    renderAll();
    showToast("Registration submitted under the participant profile.");
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
    const courseId = newId("course");
    const courseData = {
      id: courseId,
      programId,
      name: form.get("name").trim(),
      start,
      end,
      seats: Number(form.get("seats")),
      hallId,
      hall: hallName(hallId),
      teacher: form.get("teacher").trim(),
      eligibility: form.get("eligibility").trim() || program?.eligibility || ""
    };
    courseData.status = programLifecycleStatus(courseData);
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
    calendarDate = new Date(`${start}T00:00:00`);
    event.currentTarget.reset();
    $("#courseDialog").close();
    activateView("courses");
    renderAll();
    showToast("Program schedule added.");
  });
  $("#programForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existingProgram = state.programs.find((program) => program.id === form.get("id"));
    const programData = {
      id: form.get("id") || newId("program"),
      parentId: form.get("parentId"),
      code: form.get("code").trim(),
      name: form.get("name").trim(),
      level: form.get("level").trim(),
      duration: form.get("duration").trim(),
      eligibility: form.get("eligibility").trim(),
      sessionTemplates: existingProgram?.sessionTemplates || []
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
    const teacherData = {
      id: form.get("id") || newId("teacher"),
      name: form.get("name").trim(),
      speciality: form.get("speciality").trim(),
      phone: form.get("phone").trim(),
      email: form.get("email").trim(),
      notes: form.get("notes").trim()
    };
    const existingIndex = state.teachers.findIndex((teacher) => teacher.id === teacherData.id);
    if (existingIndex >= 0) {
      const previousName = state.teachers[existingIndex].name;
      state.teachers[existingIndex] = teacherData;
      state.courses.forEach((course) => {
        if (course.teacher === previousName) course.teacher = teacherData.name;
      });
    } else {
      state.teachers.push(teacherData);
    }
    event.currentTarget.reset();
    $("#teacherDialog").close();
    renderAll();
    showToast(existingIndex >= 0 ? "Teacher updated." : "Teacher added to master.");
  });
  $("#recordForm").addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    saveRecordForm(event.currentTarget);
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
