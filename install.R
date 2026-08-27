# Socratic Tutor — student installer
#
# Students run one line, with the class token their instructor handed out:
#
#   source("https://raw.githubusercontent.com/benrosche/socratic-tutor/master/install.R")
#   install_tutor(token = "...", student = "your-github-username")
#
# This writes to the user-level Posit Assistant configuration, so it works no
# matter which folder a student keeps their lab notebooks in:
#
#   <home>/.posit/assistant/skills/tutor/SKILL.md      the tutor's instructions
#   <home>/.posit/assistant/settings.json              gains an mcpServers entry
#
# Nothing secret lives in this file or in any repository — the token is supplied
# by the student at install time and only ever written to their own machine.
#
# install_tutor() finishes by actually calling the course server and reporting
# what came back. Writing a config file always "succeeds"; the only thing a
# student cares about is whether the tutor can reach their course, so that is
# what gets reported. tutor_check() re-runs that test at any time.

TUTOR_DEFAULT_SKILL_URL <- paste0(
  "https://raw.githubusercontent.com/benrosche/socratic-tutor/master/",
  "templates/lab-repo/.posit/assistant/skills/tutor/SKILL.md"
)

# On Windows, R expands "~" to the Documents folder, not the user profile — so
# path.expand("~/.posit") would quietly write to the wrong place for most
# students. Resolve the real home directory explicitly.
tutor_home <- function() {
  if (.Platform$OS.type == "windows") {
    profile <- Sys.getenv("USERPROFILE")
    if (nzchar(profile)) return(normalizePath(profile, winslash = "/", mustWork = FALSE))
  }
  home <- Sys.getenv("HOME")
  if (!nzchar(home)) home <- path.expand("~")
  normalizePath(home, winslash = "/", mustWork = FALSE)
}

tutor_config_dir <- function(dir = NULL) {
  if (is.null(dir)) file.path(tutor_home(), ".posit", "assistant") else dir
}

# Mirrors the server's normalization so a student sees the same identity here
# that the instructor's dashboard will group their questions under.
tutor_normalize_student <- function(student) {
  # Trim before stripping the "@", or a leading space hides it from the anchor.
  value <- tolower(sub("^@", "", trimws(student)))
  if (!grepl("^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$", value, perl = TRUE)) {
    stop("\"", student, "\" is not a valid GitHub username. Use letters, digits and hyphens.",
         call. = FALSE)
  }
  value
}

# --- talking to the server ---------------------------------------------------

# The MCP endpoint answers as server-sent events ("data: {...}") rather than a
# bare JSON body, so pull the payload out of whichever shape arrived.
tutor_parse_mcp <- function(txt) {
  lines <- strsplit(txt, "\r?\n")[[1]]
  payload <- sub("^data:[[:space:]]*", "", lines[grepl("^data:", lines)])
  if (!length(payload)) payload <- txt
  jsonlite::fromJSON(paste(payload, collapse = ""), simplifyVector = FALSE)
}

#' Ask the course server whether it can see this student.
#'
#' Reads the installed configuration, so it takes no arguments once
#' install_tutor() has run. Returns invisibly a list with `ok` and, when the
#' call succeeded, the fields the server reported.
tutor_check <- function(dir = NULL, quiet = FALSE) {
  dir <- tutor_config_dir(dir)
  settings_file <- file.path(dir, "settings.json")

  say <- function(...) if (!quiet) message(...)

  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    say("Cannot check: the 'jsonlite' package is missing.")
    return(invisible(list(ok = FALSE, reason = "no-jsonlite")))
  }
  if (!file.exists(settings_file)) {
    say("Not installed yet — no settings file at\n  ", settings_file,
        "\nRun install_tutor(token = \"...\", student = \"...\") first.")
    return(invisible(list(ok = FALSE, reason = "not-installed")))
  }

  settings <- tryCatch(jsonlite::fromJSON(settings_file, simplifyVector = FALSE),
                       error = function(e) NULL)
  entry <- settings$mcpServers$tutor
  if (is.null(entry)) {
    say("Not installed yet — no \"tutor\" entry in\n  ", settings_file,
        "\nRun install_tutor(token = \"...\", student = \"...\") first.")
    return(invisible(list(ok = FALSE, reason = "no-entry")))
  }

  # curl is not needed to install, only to verify, so its absence is a soft
  # failure — the config is still written and the tutor may well work.
  if (!requireNamespace("curl", quietly = TRUE)) {
    say("Skipping the connection test: the 'curl' package is not installed.\n",
        "  Install it with  install.packages(\"curl\")  to get this check.")
    return(invisible(list(ok = NA, reason = "no-curl")))
  }

  body <- '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"check_connection","arguments":{}}}'
  h <- curl::new_handle()
  curl::handle_setheaders(
    h,
    "Authorization"   = entry$headers$Authorization,
    "X-Tutor-Student" = entry$headers$`X-Tutor-Student`,
    "Content-Type"    = "application/json",
    "Accept"          = "application/json, text/event-stream"
  )
  curl::handle_setopt(h, post = TRUE, postfields = body, timeout = 20L)

  resp <- tryCatch(curl::curl_fetch_memory(entry$url, handle = h),
                   error = function(e) e)

  if (inherits(resp, "error")) {
    say("Could not reach the course server at\n  ", entry$url,
        "\n  ", conditionMessage(resp),
        "\nCheck your internet connection. If it persists, tell your instructor.")
    return(invisible(list(ok = FALSE, reason = "unreachable")))
  }

  txt <- rawToChar(resp$content)

  if (resp$status_code == 401) {
    say("The server rejected the class token (401).\n",
        "  Check the token your instructor gave you and run install_tutor() again.")
    return(invisible(list(ok = FALSE, reason = "bad-token")))
  }
  if (resp$status_code == 400) {
    say("The server rejected the username \"", entry$headers$`X-Tutor-Student`, "\" (400).\n",
        "  Re-run install_tutor() with your GitHub username.")
    return(invisible(list(ok = FALSE, reason = "bad-student")))
  }
  if (resp$status_code >= 400) {
    say("The server answered with HTTP ", resp$status_code, ".\n  ", substr(txt, 1, 300))
    return(invisible(list(ok = FALSE, reason = paste0("http-", resp$status_code))))
  }

  info <- tryCatch({
    parsed <- tutor_parse_mcp(txt)
    jsonlite::fromJSON(parsed$result$content[[1]]$text, simplifyVector = TRUE)
  }, error = function(e) NULL)

  if (is.null(info)) {
    say("The server answered, but not in a shape this installer understands.\n",
        "  Tell your instructor. Raw reply:\n  ", substr(txt, 1, 300))
    return(invisible(list(ok = FALSE, reason = "unparseable")))
  }

  say("  Connected to the course server.")
  say("    course        : ", info$course)
  say("    it sees you as: ", info$student_seen_by_server)
  say("    exercises     : ", info$tasks_loaded, " loaded")

  # Reaching the server is not the same as being ready to tutor: a course with
  # nothing loaded yet answers happily and then finds no solutions.
  if (isTRUE(info$tasks_loaded == 0)) {
    say("\n  Note: no exercises are loaded for this course yet. The tutor will",
        "\n  connect but cannot check your work. That is your instructor's to fix.")
  }

  invisible(list(ok = TRUE, info = info))
}

# --- install / uninstall -----------------------------------------------------

install_tutor <- function(token,
                          student,
                          url = "https://socratic-tutor.up.railway.app",
                          skill_url = TUTOR_DEFAULT_SKILL_URL,
                          dir = NULL) {

  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("The 'jsonlite' package is required. Install it with:\n\n",
         "    install.packages(\"jsonlite\")\n\nthen run install_tutor() again.",
         call. = FALSE)
  }

  if (missing(token) || !nzchar(trimws(token))) {
    stop("A class token is required. Your instructor gives this out.\n",
         "  install_tutor(token = \"...\", student = \"your-github-username\")",
         call. = FALSE)
  }
  if (missing(student)) {
    stop("A GitHub username is required.\n",
         "  install_tutor(token = \"...\", student = \"your-github-username\")",
         call. = FALSE)
  }
  if (!grepl("^https://", url)) {
    stop("The server url must start with https://", call. = FALSE)
  }
  if (grepl("REPLACE-ME", url)) {
    stop("Pass your course's server url, e.g. url = \"https://tutor-abc123.up.railway.app\".",
         call. = FALSE)
  }

  token   <- trimws(token)
  student <- tutor_normalize_student(student)
  url     <- sub("/+$", "", url)
  dir     <- tutor_config_dir(dir)

  skill_dir <- file.path(dir, "skills", "tutor")
  dir.create(skill_dir, recursive = TRUE, showWarnings = FALSE)

  # --- the tutor's instructions ------------------------------------------
  skill_file <- file.path(skill_dir, "SKILL.md")
  ok <- tryCatch({
    if (file.exists(skill_url)) {
      # A local path, so an instructor can try a customized skill before
      # publishing it. Students always get the URL form.
      file.copy(skill_url, skill_file, overwrite = TRUE)
    } else {
      utils::download.file(skill_url, skill_file, quiet = TRUE, mode = "wb")
    }
    TRUE
  }, error = function(e) FALSE)

  if (!ok || !file.exists(skill_file) || file.size(skill_file) < 500) {
    stop("Could not download the tutor instructions from:\n  ", skill_url,
         "\nCheck your internet connection and try again.", call. = FALSE)
  }

  # --- point Posit Assistant at the course server ------------------------
  settings_file <- file.path(dir, "settings.json")

  settings <- list()
  if (file.exists(settings_file)) {
    settings <- tryCatch(
      jsonlite::fromJSON(settings_file, simplifyVector = FALSE),
      error = function(e) {
        stop("Your settings file could not be read as JSON:\n  ", settings_file,
             "\nFix or rename it, then run install_tutor() again.", call. = FALSE)
      }
    )
    # Never clobber an existing config without a way back.
    backup <- paste0(settings_file, ".bak-", format(Sys.time(), "%Y%m%d-%H%M%S"))
    file.copy(settings_file, backup)
    message("Backed up your existing settings to:\n  ", backup)
  }

  if (is.null(settings$mcpServers)) settings$mcpServers <- list()
  settings$mcpServers$tutor <- list(
    type    = "remote",
    url     = paste0(url, "/mcp"),
    headers = list(
      Authorization     = paste("Bearer", token),
      `X-Tutor-Student` = student
    ),
    enabled = TRUE,
    timeout = 15000
  )

  writeLines(
    jsonlite::toJSON(settings, auto_unbox = TRUE, pretty = TRUE, null = "null"),
    settings_file
  )

  message("\nFiles written.\n")
  message("  instructions : ", skill_file)
  message("  settings     : ", settings_file)
  message("  identity     : ", student)
  message("  server       : ", url)

  message("\nTesting the connection...\n")
  result <- tutor_check(dir = dir)

  message("")
  if (isTRUE(result$ok)) {
    message("Done. One more step: quit Positron completely — every window, not a")
    message("reload — then reopen it and ask the tutor:\n")
    message("    /tutor are you connected?\n")
    message("It should report the same course and username shown above.\n")
    message("If Positron asks whether to allow the tutor to use the course server,")
    message("choose \"Always Allow\". Most course repos pre-approve this, so you may")
    message("never see it — but a tutor that has been denied keeps talking without")
    message("the reference solution, and the hints go vague with no error to explain.")
  } else if (identical(result$ok, NA)) {
    message("Installed, but the connection was not tested (see above).")
    message("Restart Positron and ask:  /tutor are you connected?")
  } else {
    message("Installed, but the tutor could NOT reach your course (see above).")
    message("Restarting Positron will not fix this on its own — sort the problem")
    message("above first, then run:  tutor_check()")
  }

  invisible(list(skill = skill_file, settings = settings_file,
                 student = student, ok = result$ok))
}

# Removes what install_tutor() added, leaving the rest of the config alone.
uninstall_tutor <- function(dir = NULL) {
  dir <- tutor_config_dir(dir)

  unlink(file.path(dir, "skills", "tutor"), recursive = TRUE)

  settings_file <- file.path(dir, "settings.json")
  if (file.exists(settings_file) && requireNamespace("jsonlite", quietly = TRUE)) {
    settings <- jsonlite::fromJSON(settings_file, simplifyVector = FALSE)
    settings$mcpServers$tutor <- NULL
    if (length(settings$mcpServers) == 0) settings$mcpServers <- NULL
    writeLines(
      jsonlite::toJSON(settings, auto_unbox = TRUE, pretty = TRUE, null = "null"),
      settings_file
    )
  }

  message("Socratic Tutor removed. Restart Positron.")
  invisible(TRUE)
}

# Sourcing this file only defines the functions above and prints nothing, which
# reads exactly like a failed install. Say what to do next.
message(
  "\nSocratic Tutor installer loaded. Nothing has been installed yet.\n",
  "\nRun this, with the class token your instructor gave you:\n",
  "\n    install_tutor(token = \"paste-the-token\", student = \"your-github-username\")\n",
  "\nAlready installed? Check it with  tutor_check()  —  remove it with  uninstall_tutor()\n"
)
