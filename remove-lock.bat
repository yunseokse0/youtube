@echo off
echo Attempting to remove Git lock file...
if exist ".git\index.lock" (
    del ".git\index.lock"
    echo Lock file removed successfully.
) else (
    echo Lock file not found.
)
echo Done.
pause