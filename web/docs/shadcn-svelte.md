# Installation

# Components

## Accordion

A vertically stacked set of interactive headings that each reveal a section of content.

```sh
npx shadcn-svelte@latest add accordion
```

```svelte
<script lang="ts">
  import * as Accordion from "$lib/components/ui/accordion/index.js";
</script>
 
<Accordion.Root type="single">
  <Accordion.Item value="item-1">
    <Accordion.Trigger>Is it accessible?</Accordion.Trigger>
    <Accordion.Content>
      Yes. It adheres to the WAI-ARIA design pattern.
    </Accordion.Content>
  </Accordion.Item>
</Accordion.Root>
```

## Alert Dialog

A modal dialog that interrupts the user with important content and expects a response.

```sh
npx shadcn-svelte@latest add alert-dialog
```

```svelte
<script lang="ts">
  import * as AlertDialog from "$lib/components/ui/alert-dialog/index.js";
</script>
 
<AlertDialog.Root>
  <AlertDialog.Trigger>Open</AlertDialog.Trigger>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Are you absolutely sure?</AlertDialog.Title>
      <AlertDialog.Description>
        This action cannot be undone. This will permanently delete your account
        and remove your data from our servers.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <AlertDialog.Action>Continue</AlertDialog.Action>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
```

## Alert

Displays a callout for user attention.

```sh
npx shadcn-svelte@latest add alert
```

```svelte
<script lang="ts">
  import * as Alert from "$lib/components/ui/alert/index.js";
</script>
 
<Alert.Root>
  <Alert.Title>Heads up!</Alert.Title>
  <Alert.Description>
    You can add components to your app using the cli.
  </Alert.Description>
</Alert.Root>
```

## Aspect Ratio

Displays content within a desired ratio.

```sh
npx shadcn-svelte@latest add aspect-ratio
```

```svelte
<script lang="ts">
  import { AspectRatio } from "$lib/components/ui/aspect-ratio/index.js";
</script>
 
<div class="w-[450px]">
  <AspectRatio ratio={16 / 9} class="bg-muted">
    <img src="..." alt="..." class="rounded-md object-cover" />
  </AspectRatio>
</div>
```

## Avatar

An image element with a fallback for representing the user.

```sh
npx shadcn-svelte@latest add avatar
```

```svelte
<script lang="ts">
  import * as Avatar from "$lib/components/ui/avatar/index.js";
</script>
 
<Avatar.Root>
  <Avatar.Image src="https://github.com/shadcn.png" alt="@shadcn" />
  <Avatar.Fallback>CN</Avatar.Fallback>
</Avatar.Root>
```

## Badge

Displays a badge or a component that looks like a badge.

```sh
npx shadcn-svelte@latest add badge
```

```svelte
<script lang="ts">
  import { Badge } from "$lib/components/ui/badge/index.js";
</script>
 
<Badge variant="outline">Badge</Badge>
```

## Breadcrumb

Displays the path to the current resource using a hierarchy of links.

```sh
npx shadcn-svelte@latest add breadcrumb
```

```svelte
<script lang="ts">
  import * as Breadcrumb from "$lib/components/ui/breadcrumb/index.js";
</script>
 
<Breadcrumb.Root>
  <Breadcrumb.List>
    <Breadcrumb.Item>
      <Breadcrumb.Link href="/">Home</Breadcrumb.Link>
    </Breadcrumb.Item>
    <Breadcrumb.Separator />
    <Breadcrumb.Item>
      <Breadcrumb.Link href="/components">Components</Breadcrumb.Link>
    </Breadcrumb.Item>
    <Breadcrumb.Separator />
    <Breadcrumb.Item>
      <Breadcrumb.Page>Breadcrumb</Breadcrumb.Page>
    </Breadcrumb.Item>
  </Breadcrumb.List>
</Breadcrumb.Root>
```

## Button

Displays a button or a component that looks like a button.

```sh
npx shadcn-svelte@latest add button
```

```svelte
<script lang="ts">
  import { Button } from "$lib/components/ui/button/index.js";
</script>
 
<Button variant="outline">Button</Button>
```

## Calendar

A calendar component that allows users to select dates.

```sh
npx shadcn-svelte@latest add calendar
```

```svelte
<script lang="ts">
  import { getLocalTimeZone, today } from "@internationalized/date";
  import { Calendar } from "$lib/components/ui/calendar/index.js";
 
  let value = today(getLocalTimeZone());
</script>
 
<Calendar
  type="single"
  bind:value
  class="rounded-md border shadow-sm"
  captionLayout="dropdown"
/>
```

## Card

Displays a card with header, content, and footer.

```sh
npx shadcn-svelte@latest add card
```

```svelte
<script lang="ts">
  import * as Card from "$lib/components/ui/card/index.js";
</script>
 
<Card.Root>
  <Card.Header>
    <Card.Title>Card Title</Card.Title>
    <Card.Description>Card Description</Card.Description>
  </Card.Header>
  <Card.Content>
    <p>Card Content</p>
  </Card.Content>
  <Card.Footer>
    <p>Card Footer</p>
  </Card.Footer>
</Card.Root>
```

## Carousel

A carousel with motion and swipe built using Embla.

```sh
npx shadcn-svelte@latest add carousel
```

```svelte
<script lang="ts">
  import * as Carousel from "$lib/components/ui/carousel/index.js";
</script>
 
<Carousel.Root>
  <Carousel.Content>
    <Carousel.Item>...</Carousel.Item>
    <Carousel.Item>...</Carousel.Item>
    <Carousel.Item>...</Carousel.Item>
  </Carousel.Content>
  <Carousel.Previous />
  <Carousel.Next />
</Carousel.Root>
```

## Chart

**Important:** LayerChart v2 is still in pre-release and is actively evolving. Only use if you're comfortable with potential breaking changes before stable v2.

```sh
npx shadcn-svelte@latest add chart
```

```svelte
<script lang="ts">
  import * as Chart from "$lib/components/ui/chart/index.js";
  import { BarChart } from "layerchart";
 
  const data = [
    // ...
  ];
</script>
 
<Chart.Container>
  <BarChart {data} x="date" y="value">
    {#snippet tooltip()}
      <Chart.Tooltip />
    {/snippet}
  </BarChart>
</Chart.Container>
```

## Checkbox

A control that allows the user to toggle between checked and not checked.

```sh
npx shadcn-svelte@latest add checkbox
```

```svelte
<script lang="ts">
  import { Checkbox } from "$lib/components/ui/checkbox/index.js";
</script>
 
<Checkbox />
```

## Collapsible

An interactive component which expands/collapses a panel.

```sh
npx shadcn-svelte@latest add collapsible
```

```svelte
<script lang="ts">
  import * as Collapsible from "$lib/components/ui/collapsible/index.js";
</script>
 
<Collapsible.Root>
  <Collapsible.Trigger>Can I use this in my project?</Collapsible.Trigger>
  <Collapsible.Content>
    Yes. Free to use for personal and commercial projects. No attribution
    required.
  </Collapsible.Content>
</Collapsible.Root>
```

## Combobox

Autocomplete input and command palette with a list of suggestions.

```sh
npx shadcn-svelte@latest add combobox
```

```svelte
<script lang="ts">
  import CheckIcon from "@lucide/svelte/icons/check";
  import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
  import { tick } from "svelte";
  import * as Command from "$lib/components/ui/command/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { cn } from "$lib/utils.js";
 
  const frameworks = [
    {
      value: "sveltekit",
      label: "SvelteKit",
    },
    {
      value: "next.js",
      label: "Next.js",
    },
    {
      value: "nuxt.js",
      label: "Nuxt.js",
    },
    {
      value: "remix",
      label: "Remix",
    },
    {
      value: "astro",
      label: "Astro",
    },
  ];
 
  let open = $state(false);
  let value = $state("");
  let triggerRef = $state<HTMLButtonElement>(null!);
 
  const selectedValue = $derived(
    frameworks.find((f) => f.value === value)?.label
  );
 
  // We want to refocus the trigger button when the user selects
  // an item from the list so users can continue navigating the
  // rest of the form with the keyboard.
  function closeAndFocusTrigger() {
    open = false;
    tick().then(() => {
      triggerRef.focus();
    });
  }
</script>
 
<Popover.Root bind:open>
  <Popover.Trigger bind:ref={triggerRef}>
    {#snippet child({ props })}
      <Button
        variant="outline"
        class="w-[200px] justify-between"
        {...props}
        role="combobox"
        aria-expanded={open}
      >
        {selectedValue || "Select a framework..."}
        <ChevronsUpDownIcon class="ml-2 size-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-[200px] p-0">
    <Command.Root>
      <Command.Input placeholder="Search framework..." />
      <Command.List>
        <Command.Empty>No framework found.</Command.Empty>
        <Command.Group>
          {#each frameworks as framework}
            <Command.Item
              value={framework.value}
              onSelect={() => {
                value = framework.value;
                closeAndFocusTrigger();
              }}
            >
              <CheckIcon
                class={cn(
                  "mr-2 size-4",
                  value !== framework.value && "text-transparent"
                )}
              />
              {framework.label}
            </Command.Item>
          {/each}
        </Command.Group>
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
```

## Command

Fast, composable, unstyled command menu for Svelte.

```sh
npx shadcn-svelte@latest add command
```

```svelte
<script lang="ts">
  import * as Command from "$lib/components/ui/command/index.js";
</script>
 
<Command.Root>
  <Command.Input placeholder="Type a command or search..." />
  <Command.List>
    <Command.Empty>No results found.</Command.Empty>
    <Command.Group heading="Suggestions">
      <Command.Item>Calendar</Command.Item>
      <Command.Item>Search Emoji</Command.Item>
      <Command.Item>Calculator</Command.Item>
    </Command.Group>
    <Command.Separator />
    <Command.Group heading="Settings">
      <Command.Item>Profile</Command.Item>
      <Command.Item>Billing</Command.Item>
      <Command.Item>Settings</Command.Item>
    </Command.Group>
  </Command.List>
</Command.Root>
```

## Context Menu

Displays a menu to the user — such as a set of actions or functions — triggered by right click.

```sh
npx shadcn-svelte@latest add context-menu
```

```svelte
<script lang="ts">
  import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
</script>
 
<ContextMenu.Root>
  <ContextMenu.Trigger>Right click</ContextMenu.Trigger>
  <ContextMenu.Content>
    <ContextMenu.Item>Profile</ContextMenu.Item>
    <ContextMenu.Item>Billing</ContextMenu.Item>
    <ContextMenu.Item>Team</ContextMenu.Item>
    <ContextMenu.Item>Subscription</ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
```

## Data Table

|  | Status |  | Amount |  |

```sh
npx shadcn-svelte@latest add data-table
```

```svelte
type Payment = {
  id: string;
  amount: number;
  status: "pending" | "processing" | "success" | "failed";
  email: string;
};
 
export const data: Payment[] = [
  {
    id: "728ed52f",
    amount: 100,
    status: "pending",
    email: "m@example.com",
  },
  {
    id: "489e1d42",
    amount: 125,
    status: "processing",
    email: "example@gmail.com",
  },
  // ...
];
```

## Date Picker

A date picker component with range and presets.

```sh
npx shadcn-svelte@latest add date-picker
```

```svelte
<script lang="ts">
  import CalendarIcon from "@lucide/svelte/icons/calendar";
  import {
    type DateValue,
    DateFormatter,
    getLocalTimeZone,
  } from "@internationalized/date";
  import { cn } from "$lib/utils.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Calendar } from "$lib/components/ui/calendar/index.js";
  import * as Popover from "$lib/components/ui/popover/index.js";
 
  const df = new DateFormatter("en-US", {
    dateStyle: "long",
  });
 
  let value = $state<DateValue>();
</script>
 
<Popover.Root>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        variant="outline"
        class={cn(
          "w-[280px] justify-start text-left font-normal",
          !value && "text-muted-foreground"
        )}
        {...props}
      >
        <CalendarIcon class="mr-2 size-4" />
        {value ? df.format(value.toDate(getLocalTimeZone())) : "Select a date"}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-auto p-0">
    <Calendar bind:value type="single" initialFocus />
  </Popover.Content>
</Popover.Root>
```

## Dialog

A window overlaid on either the primary window or another dialog window, rendering the content underneath inert.

```sh
npx shadcn-svelte@latest add dialog
```

```svelte
<script lang="ts">
  import * as Dialog from "$lib/components/ui/dialog/index.js";
</script>
 
<Dialog.Root>
  <Dialog.Trigger>Open</Dialog.Trigger>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>Are you sure absolutely sure?</Dialog.Title>
      <Dialog.Description>
        This action cannot be undone. This will permanently delete your account
        and remove your data from our servers.
      </Dialog.Description>
    </Dialog.Header>
  </Dialog.Content>
</Dialog.Root>
```

## Drawer

A drawer component for Svelte.

```sh
npx shadcn-svelte@latest add drawer
```

```svelte
<script lang="ts">
  import * as Drawer from "$lib/components/ui/drawer/index.js";
</script>
 
<Drawer.Root>
  <Drawer.Trigger>Open</Drawer.Trigger>
  <Drawer.Content>
    <Drawer.Header>
      <Drawer.Title>Are you sure absolutely sure?</Drawer.Title>
      <Drawer.Description>This action cannot be undone.</Drawer.Description>
    </Drawer.Header>
    <Drawer.Footer>
      <Button>Submit</Button>
      <Drawer.Close>Cancel</Drawer.Close>
    </Drawer.Footer>
  </Drawer.Content>
</Drawer.Root>
```

## Dropdown Menu

Displays a menu to the user — such as a set of actions or functions — triggered by a button.

```sh
npx shadcn-svelte@latest add dropdown-menu
```

```svelte
<script lang="ts">
  import * as DropdownMenu from "$lib/components/ui/dropdown-menu/index.js";
</script>
 
<DropdownMenu.Root>
  <DropdownMenu.Trigger>Open</DropdownMenu.Trigger>
  <DropdownMenu.Content>
    <DropdownMenu.Group>
      <DropdownMenu.Label>My Account</DropdownMenu.Label>
      <DropdownMenu.Separator />
      <DropdownMenu.Item>Profile</DropdownMenu.Item>
      <DropdownMenu.Item>Billing</DropdownMenu.Item>
      <DropdownMenu.Item>Team</DropdownMenu.Item>
      <DropdownMenu.Item>Subscription</DropdownMenu.Item>
    </DropdownMenu.Group>
  </DropdownMenu.Content>
</DropdownMenu.Root>
```

## Formsnap

Building forms with Formsnap, Superforms, & Zod.

```sh
npx shadcn-svelte@latest add form
```

```svelte
import { z } from "zod";
 
export const formSchema = z.object({
  username: z.string().min(2).max(50),
});
 
export type FormSchema = typeof formSchema;
```

## Hover Card

For sighted users to preview content available behind a link.

```sh
npx shadcn-svelte@latest add hover-card
```

```svelte
<script lang="ts">
  import * as HoverCard from "$lib/components/ui/hover-card/index.js";
</script>
 
<HoverCard.Root>
  <HoverCard.Trigger>Hover</HoverCard.Trigger>
  <HoverCard.Content>
    SvelteKit - Web development, streamlined
  </HoverCard.Content>
</HoverCard.Root>
```

## Input OTP

Accessible one-time password component with copy paste functionality.

```sh
npx shadcn-svelte@latest add input-otp
```

```svelte
<script lang="ts">
  import * as InputOTP from "$lib/components/ui/input-otp/index.js";
</script>
 
<InputOTP.Root maxlength={6}>
  {#snippet children({ cells })}
    <InputOTP.Group>
      {#each cells.slice(0, 3) as cell}
        <InputOTP.Slot {cell} />
      {/each}
    </InputOTP.Group>
    <InputOTP.Separator />
    <InputOTP.Group>
      {#each cells.slice(3, 6) as cell}
        <InputOTP.Slot {cell} />
      {/each}
    </InputOTP.Group>
  {/snippet}
</InputOTP.Root>
```

## Input

Displays a form input field or a component that looks like an input field.

```sh
npx shadcn-svelte@latest add input
```

```svelte
<script lang="ts">
  import { Input } from "$lib/components/ui/input/index.js";
</script>
 
<Input />
```

## Label

Renders an accessible label associated with controls.

```sh
npx shadcn-svelte@latest add label
```

```svelte
<script lang="ts">
  import { Label } from "$lib/components/ui/label/index.js";
</script>
 
<Label for="email">Your email address</Label>
```

## Menubar

A visually persistent menu common in desktop applications that provides quick access to a consistent set of commands.

```sh
npx shadcn-svelte@latest add menubar
```

```svelte
<script lang="ts">
  import * as Menubar from "$lib/components/ui/menubar/index.js";
</script>
 
<Menubar.Root>
  <Menubar.Menu>
    <Menubar.Trigger>File</Menubar.Trigger>
    <Menubar.Content>
      <Menubar.Item>
        New Tab
        <Menubar.Shortcut>⌘T</Menubar.Shortcut>
      </Menubar.Item>
      <Menubar.Item>New Window</Menubar.Item>
      <Menubar.Separator />
      <Menubar.Item>Share</Menubar.Item>
      <Menubar.Separator />
      <Menubar.Item>Print</Menubar.Item>
    </Menubar.Content>
  </Menubar.Menu>
</Menubar.Root>
```

## Navigation Menu

```

```sh
npx shadcn-svelte@latest add navigation-menu
```

```svelte
<script lang="ts">
  import * as NavigationMenu from "$lib/components/ui/navigation-menu/index.js";
  import { cn } from "$lib/utils.js";
  import { navigationMenuTriggerStyle } from "$lib/components/ui/navigation-menu/navigation-menu-trigger.svelte";
  import type { HTMLAttributes } from "svelte/elements";
  import CircleHelpIcon from "@lucide/svelte/icons/circle-help";
  import CircleIcon from "@lucide/svelte/icons/circle";
  import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
 
  const components: { title: string; href: string; description: string }[] = [
    {
      title: "Alert Dialog",
      href: "/docs/components/alert-dialog",
      description:
        "A modal dialog that interrupts the user with important content and expects a response."
    },
    {
      title: "Hover Card",
      href: "/docs/components/hover-card",
      description:
        "For sighted users to preview content available behind a link."
    },
    {
      title: "Progress",
      href: "/docs/components/progress",
      description:
        "Displays an indicator showing the completion progress of a task, typically displayed as a progress bar."
    },
    {
      title: "Scroll-area",
      href: "/docs/components/scroll-area",
      description: "Visually or semantically separates content."
    },
    {
      title: "Tabs",
      href: "/docs/components/tabs",
      description:
        "A set of layered sections of content—known as tab panels—that are displayed one at a time."
    },
    {
      title: "Tooltip",
      href: "/docs/components/tooltip",
      description:
        "A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it."
    }
  ];
 
  type ListItemProps = HTMLAttributes<HTMLAnchorElement> & {
    title: string;
    href: string;
    content: string;
  };
</script>
 
{#snippet ListItem({
  title,
  content,
  href,
  class: className,
  ...restProps
}: ListItemProps)}
  <li>
    <NavigationMenu.Link>
      {#snippet child()}
        <a
          {href}
          class={cn(
            "hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground block select-none space-y-1 rounded-md p-3 leading-none no-underline outline-none transition-colors",
            className
          )}
          {...restProps}
        >
          <div class="text-sm font-medium leading-none">{title}</div>
          <p class="text-muted-foreground line-clamp-2 text-sm leading-snug">
            {content}
          </p>
        </a>
      {/snippet}
    </NavigationMenu.Link>
  </li>
{/snippet}
 
<NavigationMenu.Root viewport={false}>
  <NavigationMenu.List>
    <NavigationMenu.Item>
      <NavigationMenu.Trigger>Home</NavigationMenu.Trigger>
      <NavigationMenu.Content>
        <ul
          class="grid gap-2 p-2 md:w-[400px] lg:w-[500px] lg:grid-cols-[.75fr_1fr]"
        >
          <li class="row-span-3">
            <NavigationMenu.Link
              class="from-muted/50 to-muted bg-linear-to-b outline-hidden flex h-full w-full select-none flex-col justify-end rounded-md p-6 no-underline focus:shadow-md"
            >
              {#snippet child({ props })}
                <a {...props} href="/">
                  <div class="mb-2 mt-4 text-lg font-medium">shadcn-svelte</div>
                  <p class="text-muted-foreground text-sm leading-tight">
                    Beautifully designed components built with Tailwind CSS.
                  </p>
                </a>
              {/snippet}
            </NavigationMenu.Link>
          </li>
          {@render ListItem({
            href: "/docs",
            title: "Introduction",
            content:
              "Re-usable components built using Bits UI and Tailwind CSS."
          })}
          {@render ListItem({
            href: "/docs/installation",
            title: "Installation",
            content: "How to install dependencies and structure your app."
          })}
          {@render ListItem({
            href: "/docs/components/typography",
            title: "Typography",
            content: "Styles for headings, paragraphs, lists...etc"
          })}
        </ul>
      </NavigationMenu.Content>
    </NavigationMenu.Item>
    <NavigationMenu.Item>
      <NavigationMenu.Trigger>Components</NavigationMenu.Trigger>
      <NavigationMenu.Content>
        <ul
          class="grid w-[400px] gap-2 p-2 md:w-[500px] md:grid-cols-2 lg:w-[600px]"
        >
          {#each components as component, i (i)}
            {@render ListItem({
              href: component.href,
              title: component.title,
              content: component.description
            })}
          {/each}
        </ul>
      </NavigationMenu.Content>
    </NavigationMenu.Item>
 
    <NavigationMenu.Item>
      <NavigationMenu.Link>
        {#snippet child()}
          <a href="/docs" class={navigationMenuTriggerStyle()}>Docs</a>
        {/snippet}
      </NavigationMenu.Link>
    </NavigationMenu.Item>
    <NavigationMenu.Item>
      <NavigationMenu.Trigger>List</NavigationMenu.Trigger>
      <NavigationMenu.Content>
        <ul class="grid w-[300px] gap-4 p-2">
          <li>
            <NavigationMenu.Link href="#">
              <div class="font-medium">Components</div>
              <div class="text-muted-foreground">
                Browse all components in the library.
              </div>
            </NavigationMenu.Link>
            <NavigationMenu.Link href="#">
              <div class="font-medium">Documentation</div>
              <div class="text-muted-foreground">
                Learn how to use the library.
              </div>
            </NavigationMenu.Link>
            <NavigationMenu.Link href="#">
              <div class="font-medium">Blog</div>
              <div class="text-muted-foreground">
                Read our latest blog posts.
              </div>
            </NavigationMenu.Link>
          </li>
        </ul>
      </NavigationMenu.Content>
    </NavigationMenu.Item>
    <NavigationMenu.Item>
      <NavigationMenu.Trigger>Simple</NavigationMenu.Trigger>
      <NavigationMenu.Content>
        <ul class="grid w-[200px] gap-4 p-2">
          <li>
            <NavigationMenu.Link href="#">Components</NavigationMenu.Link>
            <NavigationMenu.Link href="#">Documentation</NavigationMenu.Link>
            <NavigationMenu.Link href="#">Blocks</NavigationMenu.Link>
          </li>
        </ul>
      </NavigationMenu.Content>
    </NavigationMenu.Item>
    <NavigationMenu.Item>
      <NavigationMenu.Trigger>With Icon</NavigationMenu.Trigger>
 
      <NavigationMenu.Content>
        <ul class="grid w-[200px] gap-4 p-2">
          <li>
            <NavigationMenu.Link href="#" class="flex-row items-center gap-2">
              <CircleHelpIcon />
              Backlog
            </NavigationMenu.Link>
 
            <NavigationMenu.Link href="#" class="flex-row items-center gap-2">
              <CircleIcon />
              To Do
            </NavigationMenu.Link>
 
            <NavigationMenu.Link href="#" class="flex-row items-center gap-2">
              <CircleCheckIcon />
              Done
            </NavigationMenu.Link>
          </li>
        </ul>
      </NavigationMenu.Content>
    </NavigationMenu.Item>
  </NavigationMenu.List>
</NavigationMenu.Root>
```

## Pagination

Pagination with page navigation, next and previous links.

```sh
npx shadcn-svelte@latest add pagination
```

```svelte
<script lang="ts">
  import * as Pagination from "$lib/components/ui/pagination/index.js";
</script>
 
<Pagination.Root count={100} perPage={10}>
  {#snippet children({ pages, currentPage })}
    <Pagination.Content>
      <Pagination.Item>
        <Pagination.PrevButton />
      </Pagination.Item>
      {#each pages as page (page.key)}
        {#if page.type === "ellipsis"}
          <Pagination.Item>
            <Pagination.Ellipsis />
          </Pagination.Item>
        {:else}
          <Pagination.Item>
            <Pagination.Link {page} isActive={currentPage === page.value}>
              {page.value}
            </Pagination.Link>
          </Pagination.Item>
        {/if}
      {/each}
      <Pagination.Item>
        <Pagination.NextButton />
      </Pagination.Item>
    </Pagination.Content>
  {/snippet}
</Pagination.Root>
```

## Popover

Displays rich content in a portal, triggered by a button.

```sh
npx shadcn-svelte@latest add popover
```

```svelte
<script lang="ts">
  import * as Popover from "$lib/components/ui/popover/index.js";
</script>
 
<Popover.Root>
  <Popover.Trigger>Open</Popover.Trigger>
  <Popover.Content>Place content for the popover here.</Popover.Content>
</Popover.Root>
```

## Progress

Displays an indicator showing the completion progress of a task, typically displayed as a progress bar.

```sh
npx shadcn-svelte@latest add progress
```

```svelte
<script lang="ts">
  import { Progress } from "$lib/components/ui/progress/index.js";
</script>
 
<Progress value={33} />
```

## Radio Group

A set of checkable buttons—known as radio buttons—where no more than one of the buttons can be checked at a time.

```sh
npx shadcn-svelte@latest add radio-group
```

```svelte
<script lang="ts">
  import { Label } from "$lib/components/ui/label/index.js";
  import * as RadioGroup from "$lib/components/ui/radio-group/index.js";
</script>
 
<RadioGroup.Root value="option-one">
  <div class="flex items-center space-x-2">
    <RadioGroup.Item value="option-one" id="option-one" />
    <Label for="option-one">Option One</Label>
  </div>
  <div class="flex items-center space-x-2">
    <RadioGroup.Item value="option-two" id="option-two" />
    <Label for="option-two">Option Two</Label>
  </div>
</RadioGroup.Root>
```

## Range Calendar

A calendar component that allows users to select a range of dates.

```sh
npx shadcn-svelte@latest add range-calendar
```

```svelte
<script lang="ts">
  import { getLocalTimeZone, today } from "@internationalized/date";
  import { RangeCalendar } from "$lib/components/ui/range-calendar/index.js";
 
  const start = today(getLocalTimeZone());
  const end = start.add({ days: 7 });
 
  let value = $state({
    start,
    end
  });
</script>
 
<RangeCalendar bind:value class="rounded-md border" />
```

## Resizable

Accessible resizable panel groups and layouts with keyboard support.

```sh
npx shadcn-svelte@latest add resizable
```

```svelte
<script lang="ts">
  import * as Resizable from "$lib/components/ui/resizable/index.js";
</script>
 
<Resizable.PaneGroup direction="horizontal">
  <Resizable.Pane>One</Resizable.Pane>
  <Resizable.Handle />
  <Resizable.Pane>Two</Resizable.Pane>
</Resizable.PaneGroup>
```

## Scroll Area

Augments native scroll functionality for custom, cross-browser styling.

```sh
npx shadcn-svelte@latest add scroll-area
```

```svelte
<script lang="ts">
  import { ScrollArea } from "$lib/components/ui/scroll-area/index.js";
</script>
 
<ScrollArea class="h-[200px] w-[350px] rounded-md border p-4">
  Jokester began sneaking into the castle in the middle of the night and
  leaving jokes all over the place: under the king's pillow, in his soup, even
  in the royal toilet. The king was furious, but he couldn't seem to stop
  Jokester. And then, one day, the people of the kingdom discovered that the
  jokes left by Jokester were so funny that they couldn't help but laugh. And
  once they started laughing, they couldn't stop.
</ScrollArea>
```

## Select

Displays a list of options for the user to pick from—triggered by a button.

```sh
npx shadcn-svelte@latest add select
```

```svelte
<script lang="ts">
  import * as Select from "$lib/components/ui/select/index.js";
</script>
 
<Select.Root type="single">
  <Select.Trigger class="w-[180px]"></Select.Trigger>
  <Select.Content>
    <Select.Item value="light">Light</Select.Item>
    <Select.Item value="dark">Dark</Select.Item>
    <Select.Item value="system">System</Select.Item>
  </Select.Content>
</Select.Root>
```

## Separator

Visually or semantically separates content.

```sh
npx shadcn-svelte@latest add separator
```

```svelte
<script lang="ts">
  import { Separator } from "$lib/components/ui/separator/index.js";
</script>
 
<Separator />
```

## Sheet

Extends the Dialog component to display content that complements the main content of the screen.

```sh
npx shadcn-svelte@latest add sheet
```

```svelte
<script lang="ts">
  import * as Sheet from "$lib/components/ui/sheet/index.js";
</script>
 
<Sheet.Root>
  <Sheet.Trigger>Open</Sheet.Trigger>
  <Sheet.Content>
    <Sheet.Header>
      <Sheet.Title>Are you sure absolutely sure?</Sheet.Title>
      <Sheet.Description>
        This action cannot be undone. This will permanently delete your account
        and remove your data from our servers.
      </Sheet.Description>
    </Sheet.Header>
  </Sheet.Content>
</Sheet.Root>
```

## Sidebar

A sidebar that collapses to icons.

```sh
npx shadcn-svelte@latest add sidebar
```

```svelte
<script lang="ts">
  import * as Sidebar from "$lib/components/ui/sidebar/index.js";
  import AppSidebar from "$lib/components/app-sidebar.svelte";
 
  let { children } = $props();
</script>
 
<Sidebar.Provider>
  <AppSidebar />
  <main>
    <Sidebar.Trigger />
    {@render children?.()}
  </main>
</Sidebar.Provider>
```

## Skeleton

Use to show a placeholder while content is loading.

```sh
npx shadcn-svelte@latest add skeleton
```

```svelte
<script lang="ts">
  import { Skeleton } from "$lib/components/ui/skeleton/index.js";
</script>
```

## Slider

An input where the user selects a value from within a given range.

```sh
npx shadcn-svelte@latest add slider
```

```svelte
<script lang="ts">
  import { Slider } from "$lib/components/ui/slider/index.js";
  let value = $state(33);
</script>
 
<Slider type="single" bind:value max={100} step={1} />
```

## Sonner

An opinionated toast component for Svelte.

```sh
npx shadcn-svelte@latest add sonner
```

```svelte
<script lang="ts">
  import { toast } from "svelte-sonner";
  import { Button } from "$lib/components/ui/button/index.js";
</script>
 
<Button onclick={() => toast("Hello world")}>Show toast</Button>
```

## Switch

Airplane Mode

```sh
npx shadcn-svelte@latest add switch
```

```svelte
<script lang="ts">
  import { Switch } from "$lib/components/ui/switch/index.js";
</script>
 
<Switch />
```

## Table

A responsive table component.

```sh
npx shadcn-svelte@latest add table
```

```svelte
<script lang="ts">
  import * as Table from "$lib/components/ui/table/index.js";
</script>
```

## Tabs

A set of layered sections of content—known as tab panels—that are displayed one at a time.

```sh
npx shadcn-svelte@latest add tabs
```

```svelte
<script lang="ts">
  import * as Tabs from "$lib/components/ui/tabs/index.js";
</script>
 
<Tabs.Root value="account" class="w-[400px]">
  <Tabs.List>
    <Tabs.Trigger value="account">Account</Tabs.Trigger>
    <Tabs.Trigger value="password">Password</Tabs.Trigger>
  </Tabs.List>
  <Tabs.Content value="account">
    Make changes to your account here.
  </Tabs.Content>
  <Tabs.Content value="password">Change your password here.</Tabs.Content>
</Tabs.Root>
```

## Textarea

```

```sh
npx shadcn-svelte@latest add textarea
```

```svelte
<script lang="ts">
  import { Textarea } from "$lib/components/ui/textarea/index.js";
</script>
```

## Toggle Group

A set of two-state buttons that can be toggled on or off.

```sh
npx shadcn-svelte@latest add toggle-group
```

```svelte
<script lang="ts">
  import * as ToggleGroup from "$lib/components/ui/toggle-group/index.js";
</script>
 
<ToggleGroup.Root type="single">
  <ToggleGroup.Item value="a">A</ToggleGroup.Item>
  <ToggleGroup.Item value="b">B</ToggleGroup.Item>
  <ToggleGroup.Item value="c">C</ToggleGroup.Item>
</ToggleGroup.Root>
```

## Toggle

A two-state button that can be either on or off.

```sh
npx shadcn-svelte@latest add toggle
```

```svelte
<script lang="ts">
  import { Toggle } from "$lib/components/ui/toggle/index.js";
</script>
 
<Toggle>Toggle</Toggle>
```

## Tooltip

A popup that displays information related to an element when the element receives keyboard focus or the mouse hovers over it.

```sh
npx shadcn-svelte@latest add tooltip
```

```svelte
<script lang="ts">
  import * as Tooltip from "$lib/components/ui/tooltip/index.js";
</script>
 
<Tooltip.Provider>
  <Tooltip.Root>
    <Tooltip.Trigger>Hover</Tooltip.Trigger>
    <Tooltip.Content>
      <p>Add to library</p>
    </Tooltip.Content>
  </Tooltip.Root>
</Tooltip.Provider>
```

## Typography

Styles for headings, paragraphs, lists...etc

```sh
npx shadcn-svelte@latest add typography
```

```svelte
<div>
  <h1 class="scroll-m-20 text-balance text-4xl font-extrabold tracking-tight">
    Taxing Laughter: The Joke Tax Chronicles
  </h1>
  <p class="text-muted-foreground text-xl leading-7 [&:not(:first-child)]:mt-6">
    Once upon a time, in a far-off land, there was a very lazy king who spent
    all day lounging on his throne. One day, his advisors came to him with a
    problem: the kingdom was running out of money.
  </p>
  <h2
    class="mt-10 scroll-m-20 border-b pb-2 text-3xl font-semibold tracking-tight transition-colors first:mt-0"
  >
    The King&apos;s Plan
  </h2>
  <p class="leading-7 [&:not(:first-child)]:mt-6">
    The king thought long and hard, and finally came up with
    <a href="##" class="text-primary font-medium underline underline-offset-4">
      a brilliant plan
    </a>
    : he would tax the jokes in the kingdom.
  </p>
  <blockquote class="mt-6 border-l-2 pl-6 italic">
    &quot;After all,&quot; he said, &quot;everyone enjoys a good joke, so
    it&apos;s only fair that they should pay for the privilege.&quot;
  </blockquote>
  <h3 class="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
    The Joke Tax
  </h3>
  <p class="leading-7 [&:not(:first-child)]:mt-6">
    The king&apos;s subjects were not amused. They grumbled and complained, but
    the king was firm:
  </p>
  <ul class="my-6 ml-6 list-disc [&>li]:mt-2">
    <li>1st level of puns: 5 gold coins</li>
    <li>2nd level of jokes: 10 gold coins</li>
    <li>3rd level of one-liners : 20 gold coins</li>
  </ul>
  <p class="leading-7 [&:not(:first-child)]:mt-6">
    As a result, people stopped telling jokes, and the kingdom fell into a
    gloom. But there was one person who refused to let the king&apos;s
    foolishness get him down: a court jester named Jokester.
  </p>
  <h3 class="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
    Jokester&apos;s Revolt
  </h3>
  <p class="leading-7 [&:not(:first-child)]:mt-6">
    Jokester began sneaking into the castle in the middle of the night and
    leaving jokes all over the place: under the king&apos;s pillow, in his soup,
    even in the royal toilet. The king was furious, but he couldn&apos;t seem to
    stop Jokester.
  </p>
  <p class="leading-7 [&:not(:first-child)]:mt-6">
    And then, one day, the people of the kingdom discovered that the jokes left
    by Jokester were so funny that they couldn&apos;t help but laugh. And once
    they started laughing, they couldn&apos;t stop.
  </p>
  <h3 class="mt-8 scroll-m-20 text-2xl font-semibold tracking-tight">
    The People&apos;s Rebellion
  </h3>
  <p class="leading-7 [&:not(:first-child)]:mt-6">
    The people of the kingdom, feeling uplifted by the laughter, started to tell
    jokes and puns again, and soon the entire kingdom was in on the joke.
  </p>
  <div class="my-6 w-full overflow-y-auto">
    <table class="w-full">
      <thead>
        <tr class="even:bg-muted m-0 border-t p-0">
          <th
            class="border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right"
          >
            King&apos;s Treasury
          </th>
          <th
            class="border px-4 py-2 text-left font-bold [&[align=center]]:text-center [&[align=right]]:text-right"
          >
            People&apos;s happiness
          </th>
        </tr>
      </thead>
      <tbody>
        <tr class="even:bg-muted m-0 border-t p-0">
          <td
            class="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
          >
            Empty
          </td>
          <td
            class="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
          >
            Overflowing
          </td>
        </tr>
        <tr class="even:bg-muted m-0 border-t p-0">
          <td
            class="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
          >
            Modest
          </td>
          <td
            class="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
          >
            Satisfied
          </td>
        </tr>
        <tr class="even:bg-muted m-0 border-t p-0">
          <td
            class="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
          >
            Full
          </td>
          <td
            class="border px-4 py-2 text-left [&[align=center]]:text-center [&[align=right]]:text-right"
          >
            Ecstatic
          </td>
        </tr>
      </tbody>
    </table>
  </div>
  <p class="leading-7 [&:not(:first-child)]:mt-6">
    The king, seeing how much happier his subjects were, realized the error of
    his ways and repealed the joke tax. Jokester was declared a hero, and the
    kingdom lived happily ever after.
  </p>
  <p class="leading-7 [&:not(:first-child)]:mt-6">
    The moral of the story is: never underestimate the power of a good laugh and
    always be careful of bad ideas.
  </p>
</div>
```

# Blocks

Clean, modern building blocks. Works with all Svelte projects. Copy and paste into your apps. Open Source. Free forever.

## Sidebar

A simple sidebar with navigation grouped by section

```sh
npx shadcn-svelte@latest add sidebar-01
```

+page.svelte

```svelte
<script lang="ts">
	import AppSidebar from '$lib/components/app-sidebar.svelte';
	import * as Breadcrumb from '$lib/components/ui/breadcrumb/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Sidebar from '$lib/components/ui/sidebar/index.js';
</script>

<Sidebar.Provider>
	<AppSidebar />
	<Sidebar.Inset>
		<header class="flex h-16 shrink-0 items-center gap-2 border-b px-4">
			<Sidebar.Trigger class="-ml-1" />
			<Separator orientation="vertical" class="mr-2 h-4" />
			<Breadcrumb.Root>
				<Breadcrumb.List>
					<Breadcrumb.Item class="hidden md:block">
						<Breadcrumb.Link href="#">Building Your Application</Breadcrumb.Link>
					</Breadcrumb.Item>
					<Breadcrumb.Separator class="hidden md:block" />
					<Breadcrumb.Item>
						<Breadcrumb.Page>Data Fetching</Breadcrumb.Page>
					</Breadcrumb.Item>
				</Breadcrumb.List>
			</Breadcrumb.Root>
		</header>
		<div class="flex flex-1 flex-col gap-4 p-4">
			<div class="grid auto-rows-min gap-4 md:grid-cols-3">
				<div class="aspect-video rounded-xl bg-muted/50"></div>
				<div class="aspect-video rounded-xl bg-muted/50"></div>
				<div class="aspect-video rounded-xl bg-muted/50"></div>
			</div>
			<div class="min-h-[100vh] flex-1 rounded-xl bg-muted/50 md:min-h-min"></div>
		</div>
	</Sidebar.Inset>
</Sidebar.Provider>
```

## Login

A simple login form

```sh
npx shadcn-svelte@latest add login-01
```

```svelte
<script lang="ts">
	import LoginForm from '$lib/components/login-form.svelte';
</script>

<div class="flex h-screen w-full items-center justify-center px-4">
	<LoginForm />
</div>
```
