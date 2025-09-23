<script lang="ts">
	import { Popover as PopoverPrimitive } from 'bits-ui';

	let { ...restProps } = $props();
</script>

<PopoverPrimitive.Trigger {...restProps} />
