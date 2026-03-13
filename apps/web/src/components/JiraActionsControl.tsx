import { useState } from "react";
import type { LinkedJiraTicket } from "@t3tools/contracts";
import { ChevronDownIcon, Link2OffIcon, MessageSquareIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogPopup } from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Group, GroupSeparator } from "~/components/ui/group";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { readNativeApi } from "~/nativeApi";
import { newCommandId } from "~/lib/utils";
import { jiraIsConfiguredQueryOptions } from "~/lib/jiraReactQuery";
import { JiraIcon } from "./Icons";
import { CreateJiraTicketDialog } from "./CreateJiraTicketDialog";
import { UpdateJiraProgressDialog } from "./UpdateJiraProgressDialog";

interface JiraActionsControlProps {
  threadId: string;
  linkedJiraTicket: LinkedJiraTicket | null;
  onTicketLinked: (ticket: LinkedJiraTicket) => void;
}

export function JiraActionsControl({
  threadId,
  linkedJiraTicket,
  onTicketLinked,
}: JiraActionsControlProps) {
  const { data: configStatus } = useQuery(jiraIsConfiguredQueryOptions());
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showUpdateDialog, setShowUpdateDialog] = useState(false);

  // Hide entire Jira UI when not configured (no env vars set)
  if (!linkedJiraTicket && !configStatus?.configured) return null;

  const handleOpenInBrowser = () => {
    if (!linkedJiraTicket) return;
    const api = readNativeApi();
    if (api) {
      void api.shell.openExternal(linkedJiraTicket.url);
    }
  };

  const handleUnlink = () => {
    const api = readNativeApi();
    if (api) {
      void api.orchestration
        .dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: threadId as any,
          linkedJiraTicket: null,
        })
        .catch(() => undefined);
    }
  };

  if (!linkedJiraTicket) {
    return (
      <>
        <Button variant="outline" size="xs" onClick={() => setShowCreateDialog(true)}>
          <JiraIcon className="size-3.5" />
          <span className="sr-only md:not-sr-only md:ml-0.5">Jira</span>
        </Button>

        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          {showCreateDialog && (
            <DialogPopup>
              <CreateJiraTicketDialog
                threadId={threadId}
                onClose={() => setShowCreateDialog(false)}
                onTicketLinked={onTicketLinked}
              />
            </DialogPopup>
          )}
        </Dialog>
      </>
    );
  }

  const isCompleted = linkedJiraTicket.status === "completed";

  return (
    <>
      <Group aria-label="Jira actions">
        <Button variant="outline" size="xs" onClick={handleOpenInBrowser}>
          <JiraIcon className="size-3.5" />
          <span className="sr-only md:not-sr-only md:ml-0.5">{linkedJiraTicket.key}</span>
        </Button>
        <GroupSeparator className="hidden md:block" />
        <Menu>
          <MenuTrigger
            render={<Button aria-label="Jira ticket options" size="icon-xs" variant="outline" />}
          >
            <ChevronDownIcon aria-hidden="true" className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end">
            {!isCompleted && (
              <MenuItem
                className="cursor-pointer hover:bg-accent"
                onClick={() => setShowUpdateDialog(true)}
              >
                <MessageSquareIcon className="size-3.5 mr-2" />
                Update Progress
              </MenuItem>
            )}
            <MenuItem className="cursor-pointer hover:bg-accent" onClick={handleUnlink}>
              <Link2OffIcon className="size-3.5 mr-2" />
              Unlink Ticket
            </MenuItem>
          </MenuPopup>
        </Menu>
      </Group>

      <Dialog open={showUpdateDialog} onOpenChange={setShowUpdateDialog}>
        {showUpdateDialog && (
          <DialogPopup>
            <UpdateJiraProgressDialog
              threadId={threadId}
              ticket={linkedJiraTicket}
              onClose={() => setShowUpdateDialog(false)}
            />
          </DialogPopup>
        )}
      </Dialog>
    </>
  );
}
