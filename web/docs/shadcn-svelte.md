# Installation

# Components

## Accordion

A vertically stacked set of interactive headings that each reveal a section of content.

```sh
npx shadcn-svelte@latest add accordion
```

```svelte
<script lang="ts">
	import * as Accordion from '$lib/components/ui/accordion/index.js';
</script>

<Accordion.Root type="single">
	<Accordion.Item value="item-1">
		<Accordion.Trigger>Is it accessible?</Accordion.Trigger>
		<Accordion.Content>Yes. It adheres to the WAI-ARIA design pattern.</Accordion.Content>
	</Accordion.Item>
</Accordion.Root>
```

Alert Dialog
Alert
Aspect Ratio
Avatar
Badge
Breadcrumb
Button
Calendar
Card
Carousel
Chart
Checkbox
Collapsible
Combobox
Command
Context Menu
Data Table
Date Picker
Dialog
Drawer
Dropdown Menu
Formsnap
Hover Card
Input OTP
Input
Label
Menubar
Navigation Menu
Pagination
Popover
Progress
Radio Group
Range Calendar
Resizable
Scroll Area
Select
Separator
Sheet
Sidebar
Skeleton
Slider
Sonner
Switch
Table
Tabs
Textarea
Toggle Group
Toggle
Tooltip
Typography

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
