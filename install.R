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

install_tutor <- function(token,
                          student,
                          url = "https://REPLACE-ME.up.railway.app",
                          skill_url = TUTOR_DEFAULT_SKILL_URL,
                          dir = NULL) {

  if (!requireNamespace("jsonlite", quietly = TRUE)) {
    stop("The 'jsonlite' package is required. Install it with:\n\n",
         "    install.packages(\"jsonlite\")\n\nthen run install_tutor() again.",
         call. = FALSE)
  }

  if (missing(token) || !nzchar(trimws(token))) {
    stop("A class token is required. Your instructor gives this out.", call. = FALSE)
  }
  if (missing(student)) {
    stop("A GitHub username is required, e.g. student = \"your-github-username\".", call. = FALSE)
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
  if (is.null(dir)) dir <- file.path(tutor_home(), ".posit", "assistant")

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

  message("\nSocratic Tutor installed.\n")
  message("  instructions : ", skill_file)
  message("  settings     : ", settings_file)
  message("  identity     : ", student)
  message("  server       : ", url, "\n")
  message("Next: restart Positron, then ask the tutor\n")
  message("    /tutor are you connected?\n")
  message("It will tell you whether it can reach the course server and which")
  message("username it sees for you.")

  invisible(list(skill = skill_file, settings = settings_file, student = student))
}

# Removes what install_tutor() added, leaving the rest of the config alone.
uninstall_tutor <- function(dir = NULL) {
  if (is.null(dir)) dir <- file.path(tutor_home(), ".posit", "assistant")

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
