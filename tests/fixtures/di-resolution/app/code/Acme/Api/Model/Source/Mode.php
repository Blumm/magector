<?php
declare(strict_types=1);

namespace Acme\Api\Model\Source;

class Mode implements \Magento\Framework\Data\OptionSourceInterface
{
    public function toOptionArray(): array
    {
        return [['value' => 'a', 'label' => 'A']];
    }
}
